import argparse
import asyncio
import logging
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from pathlib import Path

from aiohttp import ClientSession, ClientTimeout, web
from ind_assets.selected import SELECTED_ASSETS
from ind_atlas.collector import collect
from ind_cmc.client import Client as CmcClient
from ind_cmc.collector import Cache as CmcCache
from ind_cmc.collector import Policy as CmcPolicy
from ind_cmc.collector import collect as collect_cmc
from ind_cmc.mapping import load as load_cmc_mapping
from ind_cmc.storage import Store as CmcStore
from ind_config.loader import RuntimeConfig, load_config
from ind_core.models import PriceSnapshot, SelectedAsset
from ind_history.minute import MinuteCloser, minute_of
from ind_history.parquet import HistoryStore
from ind_logger.setup import configure
from ind_snapshot.cache import LatestSnapshot, PriceCache
from ind_snapshot.status import StatusReporter
from ind_snapshot.timer import sample_every_second
from returns.maybe import Some
from returns.result import Failure, Result, Success

from ind_server.api import make_app


class ServerErrorCode(StrEnum):
    CACHE = "cache_failed"
    START = "server_start_failed"


@dataclass(frozen=True, slots=True)
class ServerError:
    code: ServerErrorCode
    message: str


async def receive_prices(
    config: RuntimeConfig, assets: tuple[SelectedAsset, ...], cache: PriceCache
) -> None:
    match await collect(config.atlas.ws.url, config.secrets.atlas_api_key, assets, cache.apply):
        case Failure(error):
            logging.getLogger("atlas").error("%s: %s", error.code, error.message)
        case Success(_):
            logging.getLogger("atlas").warning(
                "Atlas closed the connection; prices will no longer update (no reconnect)"
            )
    # No reconnect, no invalidation, and no cancellation of the snapshot timer.


async def receive_cmc(config: RuntimeConfig, cache: CmcCache) -> None:
    timeout = ClientTimeout(total=config.cmc.timeout_seconds)
    try:
        async with ClientSession(timeout=timeout) as session:
            client = CmcClient(session, config.secrets.cmc_api_key, config.cmc.retries)
            await collect_cmc(
                client,
                cache,
                CmcStore(config.cmc.directory),
                CmcPolicy(
                    config.cmc.quote_seconds,
                    config.cmc.history_days,
                    config.cmc.history_max_query_days,
                    config.cmc.history_delay_seconds,
                ),
            )
    except Exception as error:
        logging.getLogger("cmc").error("CMC collector stopped: %s", type(error).__name__)


def make_cmc_cache(config: RuntimeConfig, assets: tuple[SelectedAsset, ...]) -> CmcCache:
    logger = logging.getLogger("cmc")
    if not config.cmc.enabled:
        return CmcCache()
    if not config.secrets.cmc_api_key:
        logger.warning("CMC disabled: IND_CMC_API_KEY is missing")
        return CmcCache()
    match load_cmc_mapping(config.cmc.mapping, assets):
        case Failure(error):
            logger.error("CMC disabled: %s", error.code)
            return CmcCache()
        case Success(()):
            logger.warning("CMC disabled: mapping is empty")
            return CmcCache()
        case Success(mappings):
            logger.info("Loaded %d approved CMC mappings", len(mappings))
            return CmcCache(mappings, enabled=True)
    raise AssertionError("Unexpected Result variant")


async def serve(config: RuntimeConfig) -> Result[None, ServerError]:
    configure(config.logger.level, config.logger.colors)
    assets = SELECTED_ASSETS
    channels = Counter(a.channel.value for a in assets)
    logging.getLogger("server").info(
        "Loaded %d compiled assets (%s)",
        len(assets),
        ", ".join(f"{count} {name}" for name, count in sorted(channels.items())),
    )
    match PriceCache.create(assets):
        case Failure(error):
            return Failure(ServerError(ServerErrorCode.CACHE, error.message))
        case Success(cache):
            pass
        case _:
            raise AssertionError("Unexpected Result variant")
    latest = LatestSnapshot()
    history = HistoryStore(config.history.directory)
    cmc = make_cmc_cache(config, assets)

    def persist(snapshot: PriceSnapshot) -> None:
        minute = minute_of(snapshot.snapshot_at)
        match history.append(snapshot):
            case Failure(error):
                logging.getLogger("history").error("%s: %s", error.code, error.message)
            case Success(_):
                logging.getLogger("history").info(
                    "Saved %s UTC minute (%d prices) to %s",
                    minute.strftime("%H:%M"),
                    len(snapshot.prices),
                    history.path(minute),
                )

    closer = MinuteCloser(persist)
    status = StatusReporter(cache, config.logger.status_interval_seconds)

    def on_clock(now: datetime) -> None:
        closer.advance(now)
        status.tick(now)

    runner = web.AppRunner(
        make_app(
            latest, history, config.server.frontend_origin, Some(cmc), config.cmc.history_days
        ),
        access_log=None,
    )
    tasks: list[asyncio.Task[None]] = []
    try:
        await runner.setup()
        await web.TCPSite(runner, config.server.host, config.server.port).start()
        logging.getLogger("server").info(
            "Listening on http://%s:%d (GET /snapshot, GET /history); history in %s",
            config.server.host,
            config.server.port,
            config.history.directory,
        )
        tasks = [
            asyncio.create_task(receive_prices(config, assets, cache)),
            asyncio.create_task(sample_every_second(cache, latest, closer.observe, on_clock)),
        ]
        if cmc.enabled:
            tasks.append(asyncio.create_task(receive_cmc(config, cmc)))
        await asyncio.gather(*tasks)
        return Success(None)
    except OSError as error:
        reason = error.strerror or type(error).__name__
        address = f"{config.server.host}:{config.server.port}"
        return Failure(ServerError(ServerErrorCode.START, f"Cannot listen on {address}: {reason}"))
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await runner.cleanup()


def main() -> None:
    parser = argparse.ArgumentParser(description="IndexFi local price server")
    parser.add_argument("--config", type=Path, default=Path("config.toml"))
    args = parser.parse_args()
    path: object = args.config
    if not isinstance(path, Path):
        raise SystemExit("Invalid config path")
    match load_config(path):
        case Failure(error):
            raise SystemExit(f"{error.code}: {error.message}")
        case Success(config):
            try:
                match asyncio.run(serve(config)):
                    case Failure(error):
                        raise SystemExit(f"{error.code}: {error.message}")
            except KeyboardInterrupt:
                pass


__all__ = [
    "ServerErrorCode",
    "ServerError",
    "serve",
    "main",
]
