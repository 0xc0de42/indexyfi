from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pyarrow as pa  # type: ignore[import-untyped]
import pyarrow.parquet as pq  # type: ignore[import-untyped]
from ind_core.boundary import is_array, is_object
from ind_core.models import AssetId, AssetPrice, FeedId, PriceSnapshot
from ind_fs.atomic import StorageError, StorageErrorCode, atomic_write
from returns.result import Failure, Result, Success

from ind_history.minute import minute_of

MAX_HISTORY_RANGE = timedelta(hours=24)

SCHEMA = pa.schema(
    [
        ("asset_id", pa.string()),
        ("feed_id", pa.uint32()),
        ("price", pa.decimal128(25, 18)),
        ("source_timestamp", pa.uint64()),
        ("snapshot_timestamp", pa.timestamp("us", tz="UTC")),
    ]
)


@dataclass(frozen=True, slots=True)
class HistoryRow:
    at: datetime
    price: AssetPrice


def decode_rows(raw: object) -> Result[tuple[HistoryRow, ...], StorageError]:
    invalid = StorageError(StorageErrorCode.INVALID_SCHEMA, "Invalid stored history row")
    if not is_array(raw):
        return Failure(invalid)
    rows: list[HistoryRow] = []
    for row in raw:
        if not is_object(row):
            return Failure(invalid)
        asset, feed, price = row.get("asset_id"), row.get("feed_id"), row.get("price")
        source, at = row.get("source_timestamp"), row.get("snapshot_timestamp")
        if not isinstance(asset, str) or type(feed) is not int or not isinstance(price, Decimal):
            return Failure(invalid)
        if type(source) is not int or not isinstance(at, datetime) or at.tzinfo is None:
            return Failure(invalid)
        rows.append(
            HistoryRow(at.astimezone(UTC), AssetPrice(AssetId(asset), FeedId(feed), price, source))
        )
    return Success(tuple(rows))


class HistoryStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        pa.set_cpu_count(1)
        pa.set_io_thread_count(1)

    def path(self, minute: datetime) -> Path:
        return self.root / minute.strftime("%Y/%m/%d/%H/%M.parquet")

    def append(self, snapshot: PriceSnapshot) -> Result[None, StorageError]:
        def write(path: Path) -> Result[None, StorageError]:
            try:
                table = pa.Table.from_pylist(
                    [
                        {
                            "asset_id": p.asset_id.value,
                            "feed_id": p.feed_id.value,
                            "price": p.price,
                            "source_timestamp": p.source_timestamp,
                            "snapshot_timestamp": snapshot.snapshot_at,
                        }
                        for p in snapshot.prices
                    ],
                    schema=SCHEMA,
                )
                pq.write_table(table, path, compression="NONE")
                return Success(None)
            except (pa.ArrowException, OSError, ValueError, TypeError):
                return Failure(
                    StorageError(StorageErrorCode.ENCODE_FAILED, "Parquet encoding failed")
                )

        return atomic_write(self.path(minute_of(snapshot.snapshot_at)), write)

    def _existing_paths(self, start: datetime, end: datetime) -> tuple[Path, ...]:
        """Visit at most 25 UTC hour directories for a bounded history query."""
        hour = start.replace(minute=0, second=0, microsecond=0)
        first_minute = minute_of(start)
        hours = (end - hour) // timedelta(hours=1) + 1
        paths: list[Path] = []
        for offset in range(hours):
            current = hour + timedelta(hours=offset)
            if current >= end:
                break
            directory = self.path(current).parent
            try:
                entries = sorted(directory.iterdir())
            except FileNotFoundError:
                continue
            for path in entries:
                if path.suffix != ".parquet" or len(path.stem) != 2:
                    continue
                if not path.stem.isascii() or not path.stem.isdecimal():
                    continue
                minute_number = int(path.stem)
                if minute_number >= 60:
                    continue
                minute = current.replace(minute=minute_number)
                if first_minute <= minute < end and path.is_file():
                    paths.append(path)
        return tuple(paths)

    def read(
        self, start: datetime, end: datetime, assets: frozenset[AssetId]
    ) -> Result[tuple[PriceSnapshot, ...], StorageError]:
        invalid = StorageError(StorageErrorCode.INVALID_RANGE, "Invalid history range")
        if start.tzinfo is None or end.tzinfo is None:
            return Failure(invalid)
        result: list[PriceSnapshot] = []
        try:
            start, end = start.astimezone(UTC), end.astimezone(UTC)
            if not timedelta(0) < end - start <= MAX_HISTORY_RANGE:
                return Failure(invalid)
            for path in self._existing_paths(start, end):
                raw: object = pq.ParquetFile(path).read(use_threads=False).to_pylist()
                match decode_rows(raw):
                    case Failure(error):
                        return Failure(error)
                    case Success(rows):
                        if not rows:
                            continue
                        at = rows[0].at
                        if any(row.at != at for row in rows):
                            return Failure(
                                StorageError(
                                    StorageErrorCode.INVALID_SCHEMA, "Mixed snapshot timestamps"
                                )
                            )
                        if not start <= at < end:
                            continue
                        prices = tuple(
                            row.price for row in rows if not assets or row.price.asset_id in assets
                        )
                        if prices:
                            result.append(PriceSnapshot(at, prices))
            return Success(tuple(result))
        except (OSError, ValueError, TypeError, OverflowError, pa.ArrowException):
            return Failure(StorageError(StorageErrorCode.READ_FAILED, "Cannot read minute history"))


__all__ = [
    "MAX_HISTORY_RANGE",
    "HistoryStore",
    "HistoryRow",
    "decode_rows",
]
