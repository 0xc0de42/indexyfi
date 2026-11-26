"""Run the production market server with local Atlas frames and a known minute close."""
import argparse
import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from aiohttp import web
from ind_assets.selected import SELECTED_ASSETS
from ind_config.loader import (
    AssetsConfig, AtlasConfig, AtlasWsConfig, HistoryConfig, LoggerConfig,
    RuntimeConfig, Secrets, ServerConfig, SnapshotConfig,
)
from ind_core.models import AssetPrice, PriceSnapshot
from ind_history.parquet import HistoryStore
from ind_server.main import serve
from returns.result import Failure


async def main(args: argparse.Namespace) -> None:
    import json

    # Include every selected reference feed so the normal readiness gate is exercised.
    prices = {asset.feed_id: Decimal({632: 2000, 751: 80000}.get(asset.feed_id.value, 1))
              for asset in SELECTED_ASSETS}
    previous = datetime.now(UTC).replace(second=59, microsecond=0) - timedelta(minutes=1)
    minute = PriceSnapshot(previous, tuple(
        AssetPrice(asset.asset_id, asset.feed_id, prices[asset.feed_id], int(previous.timestamp()))
        for asset in SELECTED_ASSETS
    ))
    if isinstance(HistoryStore(args.history).append(minute), Failure):
        raise RuntimeError("Failed to seed synthetic historical close")

    async def feed(request: web.Request) -> web.WebSocketResponse:
        socket = web.WebSocketResponse()
        await socket.prepare(request)
        # The collector batches channels; read until every selected feed is subscribed.
        channels: set[str] = set()
        while len(channels) < len(SELECTED_ASSETS):
            channels.update((await socket.receive_json())["params"])
        now = int(datetime.now(UTC).timestamp())
        rows = b"".join(asset.feed_id.value.to_bytes(4) +
                        int(prices[asset.feed_id] * 10**18).to_bytes(10) +
                        now.to_bytes(6) for asset in SELECTED_ASSETS)
        await socket.send_json({"d": json.dumps({
            "payload": (rows + bytes([len(SELECTED_ASSETS)])).hex(),
            "signature": "00" * 65, "magicMarker": "7096"
        })})
        await socket.close()
        return socket

    upstream = web.Application()
    upstream.router.add_get("/ws", feed)
    runner = web.AppRunner(upstream)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", 0).start()
    try:
        config = RuntimeConfig(
            secrets=Secrets("synthetic"), logger=LoggerConfig("WARNING", False, 0),
            server=ServerConfig("127.0.0.1", args.port, args.origin),
            atlas=AtlasConfig(AtlasWsConfig(f"ws://127.0.0.1:{runner.addresses[0][1]}/ws")),
            assets=AssetsConfig(args.history, args.history, args.history),
            snapshot=SnapshotConfig(1), history=HistoryConfig(args.history, 60),
        )
        if isinstance(await serve(config), Failure):
            raise RuntimeError("Market service startup failed")
    finally:
        await runner.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--history", required=True, type=Path)
    asyncio.run(main(parser.parse_args()))
