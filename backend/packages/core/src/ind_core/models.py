from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import StrEnum


@dataclass(frozen=True, slots=True)
class AssetId:
    value: str


@dataclass(frozen=True, slots=True)
class FeedId:
    value: int


class FeedChannel(StrEnum):
    PUBLIC = "public"
    PRIVATE = "private"


@dataclass(frozen=True, slots=True)
class SelectedAsset:
    asset_id: AssetId
    symbol: str
    feed_id: FeedId
    channel: FeedChannel


@dataclass(frozen=True, slots=True)
class PriceObservation:
    feed_id: FeedId
    price: Decimal
    source_timestamp: int


@dataclass(frozen=True, slots=True)
class AssetPrice:
    asset_id: AssetId
    feed_id: FeedId
    price: Decimal
    source_timestamp: int


@dataclass(frozen=True, slots=True)
class PriceSnapshot:
    snapshot_at: datetime
    prices: tuple[AssetPrice, ...]


__all__ = [
    "AssetId",
    "FeedId",
    "FeedChannel",
    "SelectedAsset",
    "PriceObservation",
    "AssetPrice",
    "PriceSnapshot",
]
