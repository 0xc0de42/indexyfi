from typing import TypedDict

from ind_core.models import PriceSnapshot


class AssetPriceJson(TypedDict):
    asset_id: str
    feed_id: int
    price: str
    source_timestamp: int


class SnapshotJson(TypedDict):
    snapshot_at: str
    prices: list[AssetPriceJson]


class HistoryJson(TypedDict):
    snapshots: list[SnapshotJson]


def snapshot_json(snapshot: PriceSnapshot) -> SnapshotJson:
    return {
        "snapshot_at": snapshot.snapshot_at.isoformat(),
        "prices": [
            {
                "asset_id": p.asset_id.value,
                "feed_id": p.feed_id.value,
                "price": format(p.price, "f"),
                "source_timestamp": p.source_timestamp,
            }
            for p in snapshot.prices
        ],
    }


__all__ = [
    "AssetPriceJson",
    "SnapshotJson",
    "HistoryJson",
    "snapshot_json",
]
