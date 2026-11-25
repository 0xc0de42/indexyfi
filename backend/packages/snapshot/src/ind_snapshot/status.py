import logging
import time
from collections.abc import Callable
from datetime import datetime

from returns.maybe import Some

from ind_snapshot.cache import CacheStats, PriceCache

log = logging.getLogger("status")


def _names(symbols: tuple[str, ...], limit: int = 8) -> str:
    shown = ", ".join(symbols[:limit])
    extra = len(symbols) - limit
    return f"{shown} (+{extra} more)" if extra > 0 else shown


def describe(stats: CacheStats, now: datetime, elapsed: float) -> tuple[int, str]:
    """Return the log level and message for one status interval."""
    window = f"{elapsed:.0f}s"
    match stats.oldest_source_timestamp:
        case Some(oldest):
            age = f"{max(0, int(now.timestamp()) - oldest)}s old"
        case _:
            age = "n/a"
    if stats.priced < stats.expected:
        return (
            logging.INFO,
            f"Waiting for initial prices: {stats.priced}/{stats.expected} feeds priced "
            f"({stats.updates} updates in the last {window}); missing {_names(stats.missing)}",
        )
    if stats.updates == 0:
        return (
            logging.WARNING,
            f"No Atlas price updates in the last {window}; serving cached prices, oldest {age}",
        )
    message = (
        f"{stats.priced}/{stats.expected} feeds priced; "
        f"{stats.expected - len(stats.quiet)} updated in the last {window} "
        f"({stats.updates} updates, {stats.updates / max(elapsed, 1e-9):.0f}/s); oldest price {age}"
    )
    if stats.quiet:
        message += f"; no update from {_names(stats.quiet)}"
    return (logging.INFO, message)


class StatusReporter:
    """Logs cache coverage and update rates every `interval_seconds` (0 disables)."""

    def __init__(
        self,
        cache: PriceCache,
        interval_seconds: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._cache = cache
        self._interval = interval_seconds
        self._clock = clock
        self._last = clock()

    def tick(self, now: datetime) -> None:
        if self._interval <= 0:
            return
        current = self._clock()
        elapsed = current - self._last
        # Ticks arrive about once per second; allow half a tick of slack so a
        # 10 s interval is not reported as 11 s when a tick lands at 9.999 s.
        if elapsed + 0.5 < self._interval:
            return
        self._last = current
        level, message = describe(self._cache.drain_stats(), now, elapsed)
        log.log(level, message)


__all__ = [
    "describe",
    "StatusReporter",
]
