import logging
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from ind_config.loader import ConfigErrorCode, load_config
from ind_core.models import AssetId, FeedChannel, FeedId, PriceObservation, SelectedAsset
from ind_snapshot.cache import PriceCache
from ind_snapshot.status import StatusReporter, describe
from returns.maybe import Nothing, Some
from returns.result import Failure, Success

NOW = datetime.fromtimestamp(1_000, UTC)
ASSETS = (
    SelectedAsset(AssetId("a"), "AAA", FeedId(1), FeedChannel.PUBLIC),
    SelectedAsset(AssetId("b"), "BBB", FeedId(2), FeedChannel.PUBLIC),
)


def make_cache() -> PriceCache:
    created = PriceCache.create(ASSETS)
    assert isinstance(created, Success)
    return created.unwrap()


def test_drain_stats_counts_and_resets() -> None:
    cache = make_cache()
    stats = cache.drain_stats()
    assert (stats.priced, stats.updates, stats.frames) == (0, 0, 0)
    assert stats.missing == ("AAA", "BBB")
    assert stats.oldest_source_timestamp is Nothing
    cache.apply(
        (PriceObservation(FeedId(1), Decimal(1), 990), PriceObservation(FeedId(9), Decimal(0), 1))
    )
    cache.apply((PriceObservation(FeedId(2), Decimal(2), 995),))
    stats = cache.drain_stats()
    assert (stats.priced, stats.updates, stats.frames) == (2, 2, 2)
    assert stats.missing == () and stats.quiet == ()
    assert stats.oldest_source_timestamp == Some(990)
    cache.apply((PriceObservation(FeedId(1), Decimal(1), 999),))
    stats = cache.drain_stats()
    assert (stats.updates, stats.frames, stats.quiet) == (1, 1, ("BBB",))


def test_describe_levels_and_messages() -> None:
    cache = make_cache()
    cache.apply((PriceObservation(FeedId(1), Decimal(1), 990),))
    level, message = describe(cache.drain_stats(), NOW, 10.0)
    assert level == logging.INFO
    assert message.startswith("Waiting for initial prices: 1/2 feeds priced")
    assert message.endswith("missing BBB")

    cache.apply((PriceObservation(FeedId(2), Decimal(2), 997),))
    level, message = describe(cache.drain_stats(), NOW, 10.0)
    assert level == logging.INFO
    assert "2/2 feeds priced; 1 updated in the last 10s" in message
    assert "(1 updates, 0/s); oldest price 10s old; no update from AAA" in message

    level, message = describe(cache.drain_stats(), NOW, 10.0)
    assert level == logging.WARNING
    assert message.startswith("No Atlas price updates in the last 10s")


def test_reporter_respects_interval(caplog: pytest.LogCaptureFixture) -> None:
    clock = [0.0]
    reporter = StatusReporter(make_cache(), 10, clock=lambda: clock[0])
    with caplog.at_level(logging.INFO, logger="status"):
        clock[0] = 9.4
        reporter.tick(NOW)
        assert caplog.records == []
        clock[0] = 9.6
        reporter.tick(NOW)
        assert len(caplog.records) == 1
        disabled = StatusReporter(make_cache(), 0, clock=lambda: clock[0])
        clock[0] = 100.0
        disabled.tick(NOW)
        assert len(caplog.records) == 1


def test_status_interval_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IND_ATLAS_API_KEY", "fixture-env-secret")
    base = (Path(__file__).resolve().parents[1] / "config.toml").read_text()
    path = tmp_path / "config.toml"
    path.write_text(base)
    result = load_config(path)
    assert isinstance(result, Success)
    assert result.unwrap().logger.status_interval_seconds == 10
    path.write_text(base.replace("status_interval_seconds = 10\n", ""))
    assert load_config(path).unwrap().logger.status_interval_seconds == 10
    path.write_text(base.replace("status_interval_seconds = 10", "status_interval_seconds = -1"))
    invalid = load_config(path)
    assert isinstance(invalid, Failure)
    assert invalid.failure().code == ConfigErrorCode.INVALID_FIELD
