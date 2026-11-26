import asyncio
import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from ind_assets.selected import SELECTED_ASSETS
from ind_cmc.client import Endpoint, Payload, decode
from ind_cmc.collector import Cache, completed_end, request_start
from ind_cmc.mapping import load
from ind_cmc.models import CmcAssetId, DailyQuote, Kind, Mapping, Provenance, Relation
from ind_cmc.parsers import historical, quotes
from ind_cmc.serialization import history_json, quote_json
from ind_cmc.storage import Series, Store
from ind_config.loader import parse_cmc
from ind_server.cmc_api import add_routes
from returns.maybe import Nothing, Some
from returns.result import Failure, Success

AT = datetime(2026, 11, 26, 12, tzinfo=UTC)
DAY = date(2026, 11, 25)
BTC = CmcAssetId(1, Kind.CRYPTO)
PROVENANCE = Provenance(Endpoint.HISTORY.value, AT, "0" * 64, (("id", "1"),), 1)


def daily() -> DailyQuote:
    return DailyQuote(
        BTC,
        DAY,
        AT,
        Some(Decimal("1.123456789012345678901")),
        Some(Decimal("20")),
        Nothing,
        PROVENANCE,
    )


def test_provider_envelope_and_exact_decimal() -> None:
    raw = b'{"status":{"error_code":"0","credit_count":2},"data":[1.123456789012345678901]}'
    match decode(raw, Endpoint.QUOTES.value, (("id", "1"),)):
        case Success(payload):
            assert payload.data == [Decimal("1.123456789012345678901")]
            assert payload.provenance.credit_count == 2
        case _:
            raise AssertionError("Expected decoded payload")
    assert isinstance(decode(b'{"status":{"error_code":1010},"data":[]}', "x", ()), Failure)


def test_latest_and_historical_quote_shapes() -> None:
    latest = Payload(
        [
            {
                "id": 1,
                "cmc_rank": 1,
                "tags": [{"slug": "pow"}],
                "quote": [
                    {
                        "id": 2781,
                        "symbol": "USD",
                        "price": "123.001",
                        "volume_24h": 100,
                        "market_cap": 200,
                        "percent_change_30d": "-1.25",
                        "last_updated": "2026-11-26T11:59:00Z",
                    }
                ],
            }
        ],
        PROVENANCE,
    )
    match quotes(latest, Kind.CRYPTO, frozenset({1})):
        case Success((value,)):
            assert quote_json(value)["price"] == "123.001"
            assert quote_json(value)["percent_change_30d"] == "-1.25"
        case _:
            raise AssertionError("Expected latest quote")
    history = Payload(
        {
            "1": {
                "id": 1,
                "quotes": [
                    {
                        "timestamp": "2026-11-25T00:00:00Z",
                        "quote": {
                            "USD": {
                                "price": "120.5",
                                "market_cap": 190,
                                "volume_24h": 90,
                                "timestamp": "2026-11-25T00:02:00Z",
                            }
                        },
                    }
                ],
            }
        },
        PROVENANCE,
    )
    match historical(history, Kind.CRYPTO, frozenset({1}), DAY, DAY + timedelta(days=1)):
        case Success((value,)):
            assert history_json(value)["price"] == "120.5"
            assert value.at == datetime(2026, 11, 25, 0, 2, tzinfo=UTC)
        case _:
            raise AssertionError("Expected daily quote")


def test_mapping_requires_approved_identity(tmp_path: Path) -> None:
    path = tmp_path / "cmc.json"
    row = {
        "asset_id": SELECTED_ASSETS[0].asset_id.value,
        "kind": "crypto",
        "cmc_id": 1,
        "relation": "exact_token",
        "evidence": "CMC BNB address match",
    }
    path.write_text(json.dumps({"mappings": [row]}))
    assert isinstance(load(path, SELECTED_ASSETS), Success)
    path.write_text(json.dumps({"mappings": [row, row]}))
    assert isinstance(load(path, SELECTED_ASSETS), Failure)


def test_append_only_store_and_watermark(tmp_path: Path) -> None:
    store = Store(tmp_path)
    first = Series((daily(),))
    assert store.write(BTC, first) == Success(None)
    assert store.read(BTC) == Success(first)
    second = DailyQuote(
        BTC,
        DAY + timedelta(days=2),
        AT + timedelta(days=2),
        Some(Decimal("2")),
        Nothing,
        Nothing,
        PROVENANCE,
    )
    merged = first.merge((second,))
    assert store.write(BTC, merged) == Success(None)
    assert store.read(BTC) == Success(merged)
    assert request_start(merged, DAY + timedelta(days=4), 30, 365) == DAY + timedelta(days=3)
    assert completed_end(datetime(2026, 11, 26, 0, 5, tzinfo=UTC), 600) == DAY


def test_cmc_config_defaults_and_bounds(tmp_path: Path) -> None:
    match parse_cmc({}, tmp_path):
        case Success(config):
            assert config.quote_seconds == 900
            assert config.history_days == 30
            assert config.concurrency == 1
        case _:
            raise AssertionError("Expected default CMC config")
    for raw in (
        {"enabled": "true"},
        {"history_days": 0},
        {"concurrency": 2},
        {"history_days": 31, "history_max_query_days": 30},
    ):
        assert isinstance(parse_cmc(raw, tmp_path), Failure)


def test_cmc_http_contract_includes_all_assets() -> None:
    async def run() -> None:
        asset = SELECTED_ASSETS[0]
        cache = Cache((Mapping(asset.asset_id, BTC, Relation.EXACT, "fixture"),), enabled=True)
        cache.history[BTC] = Series((daily(),))
        app = web.Application()
        add_routes(app, cache, 30)
        async with TestClient(TestServer(app)) as client:
            async with client.get("/market-metadata") as response:
                assert response.status == 200
                body = await response.json()
                assert len(body["assets"]) == 66
                assert body["assets"][0]["status"] == "pending"
            async with client.get(
                "/cmc/history",
                params={
                    "asset_id": asset.asset_id.value,
                    "start": DAY.isoformat(),
                    "end": (DAY + timedelta(days=1)).isoformat(),
                },
            ) as response:
                assert response.status == 200
                body = await response.json()
                assert body["points"][0]["price"] == "1.123456789012345678901"

    asyncio.run(run())
