import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from aiohttp import ClientSession, web
from ind_core.models import AssetId, AssetPrice, FeedId, PriceSnapshot
from ind_fs.atomic import StorageErrorCode
from ind_history.parquet import HistoryStore
from ind_server.api import ApiErrorCode, make_app, parse_history_query
from ind_snapshot.cache import LatestSnapshot
from returns.result import Failure, Success


def test_history_range_limit() -> None:
    end = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
    start = end - timedelta(hours=24)
    assert isinstance(parse_history_query({"start": start.isoformat()}, [], end), Success)
    too_early = start - timedelta(microseconds=1)
    result = parse_history_query({"start": too_early.isoformat()}, [], end)
    assert isinstance(result, Failure)
    assert result.failure().code == ApiErrorCode.INVALID_TIME_RANGE
    for invalid in (end, end + timedelta(seconds=1), start.replace(tzinfo=None)):
        assert isinstance(parse_history_query({"start": invalid.isoformat()}, [], end), Failure)
    assert isinstance(parse_history_query({"start": "2026-11-24T13:00:00+01:00"}, [], end), Success)


def test_sparse_history_and_http_limit(tmp_path: Path) -> None:
    history = HistoryStore(tmp_path)
    start = datetime(2026, 11, 25, 11, 58, 59, tzinfo=UTC)
    price = AssetPrice(AssetId("x"), FeedId(1), Decimal("1.000000000000000001"), 5)
    other = AssetPrice(AssetId("y"), FeedId(2), Decimal("2"), 6)
    earlier = PriceSnapshot(start - timedelta(minutes=1), (price,))
    first = PriceSnapshot(start, (price, other))
    last = PriceSnapshot(start + timedelta(minutes=2), (price, other))
    for value in (last, earlier, first):
        assert history.append(value) == Success(None)
    # Ignore unrelated files, including non-minute parquet names.
    (history.path(start).parent / "junk.parquet").write_bytes(b"not parquet")
    end = last.snapshot_at + timedelta(microseconds=1)
    assert history.read(start, end, frozenset()) == Success((first, last))
    assert history.read(start, last.snapshot_at, frozenset()) == Success((first,))
    assert history.read(start, end, frozenset({AssetId("unknown")})) == Success(())
    result = history.read(start - timedelta(days=2), end, frozenset())
    assert isinstance(result, Failure)
    assert result.failure().code == StorageErrorCode.INVALID_RANGE

    async def run() -> None:
        runner = web.AppRunner(make_app(LatestSnapshot(), history, "http://localhost:3000"))
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        url = f"http://127.0.0.1:{runner.addresses[0][1]}/history"
        try:
            async with ClientSession() as session:
                async with session.get(
                    url,
                    params={"start": "2000-01-01T00:00:00Z", "end": end.isoformat()},
                ) as response:
                    assert response.status == 400
                    assert await response.json() == {"error": "invalid_time_range"}
                async with session.get(
                    url,
                    params={"start": start.isoformat(), "end": end.isoformat(), "asset_id": "x"},
                ) as response:
                    assert response.status == 200
                    body = await response.json()
                    assert len(body["snapshots"]) == 2
                    assert all(len(value["prices"]) == 1 for value in body["snapshots"])
        finally:
            await runner.cleanup()

    asyncio.run(run())
