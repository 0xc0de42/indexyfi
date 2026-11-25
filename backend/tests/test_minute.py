from datetime import UTC, datetime, timedelta
from decimal import Decimal

from ind_core.models import AssetId, AssetPrice, FeedId, PriceSnapshot
from ind_history.minute import MinuteCloser
from ind_server.serialization import snapshot_json


def test_close_and_gap() -> None:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    price = AssetPrice(AssetId("x"), FeedId(1), Decimal("1.000000000000000001"), 1)
    first = PriceSnapshot(start, (price,))
    last = PriceSnapshot(start + timedelta(seconds=59), (price,))
    output: list[PriceSnapshot] = []
    closer = MinuteCloser(output.append)
    closer.observe(first)
    closer.observe(last)
    closer.advance(start + timedelta(minutes=3))
    closer.advance(start + timedelta(minutes=4))
    assert output == [last]
    assert snapshot_json(last) == {
        "snapshot_at": last.snapshot_at.isoformat(),
        "prices": [
            {"asset_id": "x", "feed_id": 1, "price": "1.000000000000000001", "source_timestamp": 1}
        ],
    }
