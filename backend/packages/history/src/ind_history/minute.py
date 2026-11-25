from collections.abc import Callable
from datetime import datetime

from ind_core.models import PriceSnapshot
from returns.maybe import Maybe, Nothing, Some


def minute_of(at: datetime) -> datetime:
    return at.replace(second=0, microsecond=0)


class MinuteCloser:
    def __init__(self, persist: Callable[[PriceSnapshot], None]) -> None:
        self._pending: Maybe[PriceSnapshot] = Nothing
        self._persist = persist

    def advance(self, now: datetime) -> None:
        match self._pending:
            case Some(pending) if minute_of(pending.snapshot_at) < minute_of(now):
                self._pending = Nothing
                self._persist(pending)

    def observe(self, snapshot: PriceSnapshot) -> None:
        self.advance(snapshot.snapshot_at)
        self._pending = Some(snapshot)


__all__ = [
    "minute_of",
    "MinuteCloser",
]
