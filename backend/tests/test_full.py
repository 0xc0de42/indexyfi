"""Requires the actual production dependencies. No replacement containers."""

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from aiohttp import ClientSession, web
from ind_atlas.collector import collect
from ind_atlas.protocol import decode_message
from ind_core.models import (
    AssetId,
    FeedChannel,
    FeedId,
    PriceObservation,
    PriceSnapshot,
    SelectedAsset,
)
from ind_history.minute import MinuteCloser
from ind_history.parquet import HistoryStore
from ind_server.api import make_app
from ind_snapshot.cache import LatestSnapshot, PriceCache
from returns.maybe import Nothing
from returns.result import Failure, Success

from tests.fixtures import frame


def test_full_pipeline(tmp_path: Path) -> None:
    async def run() -> None:
        assets = (
            SelectedAsset(AssetId("x"), "X", FeedId(1), FeedChannel.PUBLIC),
            SelectedAsset(AssetId("y"), "Y", FeedId(2), FeedChannel.PUBLIC),
        )
        created = PriceCache.create(assets)
        assert isinstance(created, Success)
        cache, latest = created.unwrap(), LatestSnapshot()
        history = HistoryStore(tmp_path)
        app = make_app(latest, history, "http://localhost:3000")

        async def ws(request: web.Request) -> web.WebSocketResponse:
            socket = web.WebSocketResponse()
            await socket.prepare(request)
            await socket.receive_str()
            await socket.send_str(frame([(1, 1, 100)]))
            await socket.send_str(frame([(2, 2, 200), (1, 3, 50)]))
            await socket.close()
            return socket

        app.router.add_get("/ws", ws)
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        url = f"http://127.0.0.1:{runner.addresses[0][1]}"
        try:
            assert cache.sample(datetime.now(UTC)) is Nothing
            async with ClientSession() as session:
                async with session.get(url + "/snapshot") as response:
                    assert response.status == 503
                assert await collect(
                    url.replace("http", "ws") + "/ws", "fixture-only", assets, cache.apply
                ) == Success(None)
                at = datetime(2026, 1, 1, 0, 0, 59, tzinfo=UTC)
                sample = cache.sample(at).unwrap()
                assert sample.prices[0].source_timestamp == 50
                assert sample.prices[0].price == Decimal("3e-18")
                latest.publish(sample)
                assert cache.initialized

                def persist(value: PriceSnapshot) -> None:
                    assert history.append(value) == Success(None)

                closer = MinuteCloser(persist)
                closer.observe(sample)
                closer.advance(at + timedelta(seconds=1))
                async with session.get(
                    url + "/snapshot", headers={"Origin": "http://localhost:3000"}
                ) as response:
                    assert response.status == 200
                    assert (
                        response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
                    )
                    assert (await response.json())["prices"][0]["price"] == "0.000000000000000003"
                async with session.get(
                    url + "/history",
                    params={
                        "start": "2026-01-01T00:00:00Z",
                        "end": "2026-01-01T00:02:00Z",
                        "asset_id": "x",
                    },
                ) as response:
                    assert response.status == 200
                    assert len((await response.json())["snapshots"][0]["prices"]) == 1
        finally:
            await runner.cleanup()

    asyncio.run(run())


def test_result_and_cache() -> None:
    assert isinstance(decode_message("bad"), Failure)
    assert isinstance(decode_message(frame([(1, 0, 0)])), Success)
    assets = (SelectedAsset(AssetId("x"), "X", FeedId(1), FeedChannel.PUBLIC),)
    created = PriceCache.create(assets)
    assert isinstance(created, Success)
    cache = created.unwrap()
    cache.apply((PriceObservation(FeedId(99), Decimal(1), 0),))
    assert not cache.initialized
    cache.apply((PriceObservation(FeedId(1), Decimal(1), 9),))
    cache.apply((PriceObservation(FeedId(1), Decimal(0), 1),))
    assert cache.sample(datetime.now(UTC)).unwrap().prices[0].price == 0
