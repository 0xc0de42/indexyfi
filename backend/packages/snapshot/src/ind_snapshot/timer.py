import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime

from ind_core.models import PriceSnapshot
from returns.maybe import Some

from ind_snapshot.cache import LatestSnapshot, PriceCache


async def sample_every_second(
    cache: PriceCache,
    latest: LatestSnapshot,
    on_sample: Callable[[PriceSnapshot], None],
    on_clock: Callable[[datetime], None],
) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + 1.0
    initialized = False
    while True:
        await asyncio.sleep(max(0.0, deadline - loop.time()))
        now = datetime.now(UTC)
        on_clock(now)
        match cache.sample(now):
            case Some(snapshot):
                latest.publish(snapshot)
                if not initialized:
                    logging.getLogger("snapshot").info(
                        "Cache initialized: all %d feeds priced; /snapshot is now serving",
                        len(snapshot.prices),
                    )
                    initialized = True
                on_sample(snapshot)
        deadline += 1.0
        current = loop.time()
        if deadline <= current:
            deadline += int(current - deadline) + 1


__all__ = [
    "sample_every_second",
]
