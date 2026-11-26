import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pyarrow as pa  # type: ignore[import-untyped]
import pyarrow.parquet as pq  # type: ignore[import-untyped]
from ind_fs.atomic import StorageError, StorageErrorCode, atomic_replace
from returns.maybe import Maybe, Nothing, Some
from returns.result import Failure, Result, Success

from ind_cmc.errors import CmcError, CmcErrorCode
from ind_cmc.models import CmcAssetId, DailyQuote, Provenance
from ind_cmc.parsers import number, obj, timestamp
from ind_cmc.serialization import history_json

FIELDS = ("day", "timestamp", "price", "market_cap", "volume_24h", "provenance")
SCHEMA = pa.schema([(field, pa.string()) for field in FIELDS])


@dataclass(frozen=True, slots=True)
class Series:
    points: tuple[DailyQuote, ...] = ()

    @property
    def last_day(self) -> Maybe[date]:
        return Some(self.points[-1].day) if self.points else Nothing

    def merge(self, values: tuple[DailyQuote, ...]) -> "Series":
        merged = {point.day: point for point in self.points}
        merged.update((point.day, point) for point in values)
        return Series(tuple(merged[day] for day in sorted(merged)))


class Store:
    def __init__(self, root: Path) -> None:
        self.root = root

    def path(self, cid: CmcAssetId) -> Path:
        return self.root / cid.kind.value / f"{cid.value}.parquet"

    def read(self, cid: CmcAssetId) -> Result[Series, CmcError]:
        try:
            path = self.path(cid)
            if not path.exists():
                return Success(Series())
            table = pq.ParquetFile(path).read(use_threads=False)
            metadata = table.schema.metadata or {}
            if metadata.get(b"identity") != f"{cid.kind.value}:{cid.value}".encode():
                raise ValueError("Wrong stored identity")
            points: list[DailyQuote] = []
            seen: set[date] = set()
            for raw in table.to_pylist():
                row = obj(raw)
                day_value, provenance_value = row.get("day"), row.get("provenance")
                if not isinstance(day_value, str) or not isinstance(provenance_value, str):
                    raise ValueError("Invalid stored metadata")
                day = date.fromisoformat(day_value)
                if day in seen:
                    raise ValueError("Duplicate stored day")
                seen.add(day)
                raw_provenance: object = json.loads(provenance_value)
                provenance_row = obj(raw_provenance)
                endpoint = provenance_row.get("endpoint")
                digest = provenance_row.get("response_sha256")
                credit = provenance_row.get("credit_count")
                parameters = provenance_row.get("parameters")
                if (
                    not isinstance(endpoint, str)
                    or not isinstance(digest, str)
                    or type(credit) is not int
                ):
                    raise ValueError("Invalid provenance")
                parameter_rows = obj(parameters)
                pairs: list[tuple[str, str]] = []
                for key, value in parameter_rows.items():
                    if not isinstance(value, str):
                        raise ValueError("Invalid provenance parameter")
                    pairs.append((key, value))
                provenance = Provenance(
                    endpoint,
                    timestamp(provenance_row.get("fetched_at")),
                    digest,
                    tuple(sorted(pairs)),
                    credit,
                )
                points.append(
                    DailyQuote(
                        cid,
                        day,
                        timestamp(row.get("timestamp")),
                        number(row.get("price")),
                        number(row.get("market_cap")),
                        number(row.get("volume_24h")),
                        provenance,
                    )
                )
            return Success(Series(tuple(sorted(points, key=lambda point: point.day))))
        except (OSError, ValueError, TypeError, KeyError, pa.ArrowException):
            return Failure(CmcError(CmcErrorCode.STORAGE, "CMC history read failed"))

    def write(self, cid: CmcAssetId, series: Series) -> Result[None, CmcError]:
        def encode(path: Path) -> Result[None, StorageError]:
            rows: list[dict[str, object]] = []
            for point in series.points:
                row = history_json(point)
                row["provenance"] = json.dumps(row["provenance"], sort_keys=True)
                rows.append(row)
            schema = SCHEMA.with_metadata({b"identity": f"{cid.kind.value}:{cid.value}".encode()})
            try:
                pq.write_table(pa.Table.from_pylist(rows, schema=schema), path, compression="NONE")
                return Success(None)
            except (OSError, ValueError, TypeError, pa.ArrowException):
                return Failure(
                    StorageError(StorageErrorCode.ENCODE_FAILED, "CMC Parquet encoding failed")
                )

        try:
            result = atomic_replace(self.path(cid), encode)
            match result:
                case Failure(_):
                    return Failure(CmcError(CmcErrorCode.STORAGE, "CMC history write failed"))
                case Success(_):
                    return Success(None)
            raise AssertionError("Unexpected Result variant")
        except (OSError, ValueError, TypeError, pa.ArrowException):
            return Failure(CmcError(CmcErrorCode.STORAGE, "CMC history write failed"))


__all__ = ["Series", "Store"]
