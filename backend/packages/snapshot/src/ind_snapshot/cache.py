from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from ind_core.models import AssetPrice, FeedId, PriceObservation, PriceSnapshot, SelectedAsset
from returns.maybe import Maybe, Nothing, Some
from returns.result import Failure, Result, Success


class CacheErrorCode(StrEnum):
    EMPTY_REGISTRY = "empty_registry"
    DUPLICATE = "duplicate"


@dataclass(frozen=True, slots=True)
class CacheError:
    code: CacheErrorCode
    message: str


@dataclass(frozen=True, slots=True)
class CacheStats:
    """Counters since the previous drain, plus the current cache coverage."""

    expected: int
    priced: int
    frames: int
    updates: int
    missing: tuple[str, ...]
    quiet: tuple[str, ...]
    oldest_source_timestamp: Maybe[int]


class PriceCache:
    def __init__(self, assets: tuple[SelectedAsset, ...]) -> None:
        # Construction is internal; use create for untrusted registry input.
        self._assets = assets
        self._feeds = frozenset(a.feed_id for a in assets)
        self._values: dict[FeedId, PriceObservation] = {}
        self._frames = 0
        self._updates = 0
        self._touched: set[FeedId] = set()

    @classmethod
    def create(cls, assets: Sequence[SelectedAsset]) -> Result["PriceCache", CacheError]:
        if not assets:
            return Failure(CacheError(CacheErrorCode.EMPTY_REGISTRY, "Registry is empty"))
        if len({a.feed_id for a in assets}) != len(assets) or len(
            {a.asset_id for a in assets}
        ) != len(assets):
            return Failure(CacheError(CacheErrorCode.DUPLICATE, "Duplicate asset or feed"))
        return Success(cls(tuple(assets)))

    @property
    def initialized(self) -> bool:
        return bool(self._assets) and len(self._values) == len(self._assets)

    def apply(self, batch: Sequence[PriceObservation]) -> None:
        matched = 0
        for observation in batch:
            if observation.feed_id in self._feeds:
                self._values[observation.feed_id] = observation
                self._touched.add(observation.feed_id)
                matched += 1
        if matched:
            self._frames += 1
            self._updates += matched

    def drain_stats(self) -> CacheStats:
        oldest: Maybe[int] = Nothing
        if self._values:
            oldest = Some(min(v.source_timestamp for v in self._values.values()))
        stats = CacheStats(
            expected=len(self._assets),
            priced=len(self._values),
            frames=self._frames,
            updates=self._updates,
            missing=tuple(a.symbol for a in self._assets if a.feed_id not in self._values),
            quiet=tuple(a.symbol for a in self._assets if a.feed_id not in self._touched),
            oldest_source_timestamp=oldest,
        )
        self._frames = 0
        self._updates = 0
        self._touched = set()
        return stats

    def sample(self, at: datetime) -> Maybe[PriceSnapshot]:
        if not self.initialized:
            return Nothing
        return Some(
            PriceSnapshot(
                at,
                tuple(
                    AssetPrice(
                        a.asset_id,
                        a.feed_id,
                        self._values[a.feed_id].price,
                        self._values[a.feed_id].source_timestamp,
                    )
                    for a in self._assets
                ),
            )
        )


class LatestSnapshot:
    def __init__(self) -> None:
        self._latest: Maybe[PriceSnapshot] = Nothing

    def publish(self, value: PriceSnapshot) -> None:
        self._latest = Some(value)

    def latest(self) -> Maybe[PriceSnapshot]:
        return self._latest


__all__ = [
    "CacheErrorCode",
    "CacheError",
    "CacheStats",
    "PriceCache",
    "LatestSnapshot",
]
