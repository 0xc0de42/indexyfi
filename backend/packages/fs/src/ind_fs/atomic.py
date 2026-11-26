import contextlib
import os
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from returns.maybe import Maybe, Nothing, Some
from returns.result import Failure, Result, Success


class StorageErrorCode(StrEnum):
    ALREADY_EXISTS = "already_exists"
    WRITE_FAILED = "write_failed"
    READ_FAILED = "read_failed"
    ENCODE_FAILED = "encode_failed"
    INVALID_SCHEMA = "invalid_schema"
    INVALID_RANGE = "invalid_range"


@dataclass(frozen=True, slots=True)
class StorageError:
    code: StorageErrorCode
    message: str


def atomic_write(
    path: Path, writer: Callable[[Path], Result[None, StorageError]]
) -> Result[None, StorageError]:
    temporary: Maybe[Path] = Nothing
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            return Failure(
                StorageError(StorageErrorCode.ALREADY_EXISTS, "Minute already persisted")
            )
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".tmp", delete=False) as file:
            target = Path(file.name)
            temporary = Some(target)
        match writer(target):
            case Failure(error):
                return Failure(error)
        with target.open("rb") as stream:
            os.fsync(stream.fileno())
        os.replace(target, path)
        return Success(None)
    except (OSError, ValueError, TypeError):
        return Failure(StorageError(StorageErrorCode.WRITE_FAILED, "Atomic write failed"))
    finally:
        match temporary:
            case Some(value):
                with contextlib.suppress(OSError):
                    value.unlink(missing_ok=True)


__all__ = [
    "StorageErrorCode",
    "StorageError",
    "atomic_write",
]
