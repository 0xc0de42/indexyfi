import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from ind_assets.registry import RegistryErrorCode, load_candidates, parse_registry
from ind_config.loader import ConfigErrorCode, load_config
from ind_core.models import AssetId, FeedChannel, FeedId, PriceObservation, SelectedAsset
from ind_fs.atomic import StorageError, StorageErrorCode, atomic_write
from ind_history.parquet import decode_rows
from ind_server.api import ApiErrorCode, parse_history_query
from ind_server.verify import export_selection
from ind_snapshot.cache import CacheErrorCode, LatestSnapshot, PriceCache
from ind_snapshot.timer import sample_every_second
from returns.maybe import Nothing, Some
from returns.result import Failure, Result, Success


def test_typed_config_and_secret_precedence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    base = Path(__file__).resolve().parents[1]
    config_path = tmp_path / "config.toml"
    config_path.write_text((base / "config.toml").read_text())
    monkeypatch.delenv("IND_ATLAS_API_KEY", raising=False)
    result = load_config(config_path)
    assert isinstance(result, Failure)
    assert result.failure().code == ConfigErrorCode.MISSING_SECRET
    (tmp_path / ".env").write_text("IND_ATLAS_API_KEY=fixture-file-secret\n")
    result = load_config(config_path)
    assert isinstance(result, Success)
    config = result.unwrap()
    assert config.secrets.atlas_api_key == "fixture-file-secret"
    assert config.assets.registry == tmp_path / "registry/selected.json"
    assert config.assets.python_module == tmp_path / "packages/assets/src/ind_assets/selected.py"
    assert config.snapshot.interval_seconds == 1
    assert "fixture-file-secret" not in repr(config)
    monkeypatch.setenv("IND_ATLAS_API_KEY", "fixture-env-secret")
    result = load_config(config_path)
    assert isinstance(result, Success)
    assert result.unwrap().secrets.atlas_api_key == "fixture-env-secret"
    config_path.write_text(config_path.read_text().replace("port = 8000", "port = true"))
    result = load_config(config_path)
    assert isinstance(result, Failure)
    assert result.failure().code == ConfigErrorCode.INVALID_FIELD
    config_path.write_text("[broken")
    result = load_config(config_path)
    assert isinstance(result, Failure)
    assert result.failure().code == ConfigErrorCode.INVALID_TOML


def test_registry_validation() -> None:
    row = {"asset_id": "x", "symbol": "X", "feed_id": 1, "channel": "public"}
    result = parse_registry({"verified": True, "assets": [row]})
    assert isinstance(result, Success)
    assert result.unwrap() == (SelectedAsset(AssetId("x"), "X", FeedId(1), FeedChannel.PUBLIC),)
    duplicate = parse_registry({"verified": True, "assets": [row, row]})
    assert isinstance(duplicate, Failure)
    assert duplicate.failure().code == RegistryErrorCode.DUPLICATE
    assert isinstance(parse_registry({"verified": False, "assets": [row]}), Failure)
    assert isinstance(
        parse_registry({"verified": True, "assets": [row | {"feed_id": True}]}), Failure
    )
    assert isinstance(
        parse_registry({"verified": True, "assets": [row | {"symbol": "USDC"}]}), Failure
    )
    result_candidates = load_candidates(
        Path(__file__).resolve().parents[1] / "registry/candidates.json"
    )
    assert isinstance(result_candidates, Success)
    assert len(result_candidates.unwrap()) == 71


def test_registry_export_produces_finalized_sources(tmp_path: Path) -> None:
    manifest_path = tmp_path / "selected.json"
    python_path = tmp_path / "selected.py"
    selected = (SelectedAsset(AssetId("x"), "X", FeedId(1), FeedChannel.PUBLIC),)

    assert export_selection(manifest_path, python_path, selected) == Success(None)
    assert sorted(item.name for item in tmp_path.iterdir()) == ["selected.json", "selected.py"]
    assert manifest_path.read_text() == (
        '{\n  "verified": true,\n  "assets": [\n    {\n'
        '      "asset_id": "x",\n      "symbol": "X",\n'
        '      "feed_id": 1,\n      "channel": "public"\n'
        "    }\n  ]\n}\n"
    )
    assert "SELECTED_ASSETS: tuple[SelectedAsset, ...]" in python_path.read_text()
    assert "AssetId('x'), 'X', FeedId(1), FeedChannel.PUBLIC" in python_path.read_text()


def test_maybe_cache_and_scheduler() -> None:
    assets = (SelectedAsset(AssetId("x"), "X", FeedId(1), FeedChannel.PUBLIC),)
    invalid = PriceCache.create(())
    assert isinstance(invalid, Failure)
    assert invalid.failure().code == CacheErrorCode.EMPTY_REGISTRY
    assert isinstance(PriceCache.create(assets + assets), Failure)
    created = PriceCache.create(assets)
    assert isinstance(created, Success)
    cache = created.unwrap()
    latest = LatestSnapshot()
    assert latest.latest() is Nothing
    assert cache.sample(datetime.now(UTC)) is Nothing
    cache.apply((PriceObservation(FeedId(1), Decimal("1.0"), 5),))
    cache.apply((PriceObservation(FeedId(1), Decimal("0"), 1),))

    async def run() -> None:
        event = asyncio.Event()
        task = asyncio.create_task(
            sample_every_second(cache, latest, lambda _: event.set(), lambda _: None)
        )
        try:
            await asyncio.wait_for(event.wait(), timeout=3)
            assert isinstance(latest.latest(), Some)
            assert latest.latest().unwrap().prices[0].source_timestamp == 1
            assert latest.latest().unwrap().prices[0].price == 0
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(run())


def test_atomic_write_failure_and_cleanup(tmp_path: Path) -> None:
    path = tmp_path / "minute.parquet"
    error = StorageError(StorageErrorCode.ENCODE_FAILED, "fixture")

    def fail(temporary: Path) -> Result[None, StorageError]:
        temporary.write_bytes(b"partial")
        return Failure(error)

    assert atomic_write(path, fail) == Failure(error)
    assert list(tmp_path.iterdir()) == []

    def write(temporary: Path) -> Result[None, StorageError]:
        temporary.write_bytes(b"complete")
        return Success(None)

    assert atomic_write(path, write) == Success(None)
    assert path.read_bytes() == b"complete"
    result = atomic_write(path, write)
    assert isinstance(result, Failure)
    assert result.failure().code == StorageErrorCode.ALREADY_EXISTS


def test_history_typed_rows_and_query() -> None:
    at = datetime(2026, 1, 1, tzinfo=UTC)
    row = {
        "asset_id": "x",
        "feed_id": 1,
        "price": Decimal("1e-18"),
        "source_timestamp": 3,
        "snapshot_timestamp": at,
    }
    assert isinstance(decode_rows([row]), Success)
    assert isinstance(decode_rows([row | {"price": "1e-18"}]), Failure)
    assert isinstance(decode_rows([row | {"feed_id": True}]), Failure)
    result = parse_history_query({}, ["x"], at)
    assert isinstance(result, Success)
    assert result.unwrap().start == at - timedelta(minutes=5)
    assert result.unwrap().assets == frozenset({AssetId("x")})
    invalid = parse_history_query({"start": "not-a-timestamp"}, [], at)
    assert isinstance(invalid, Failure)
    assert invalid.failure().code == ApiErrorCode.INVALID_TIME_RANGE
