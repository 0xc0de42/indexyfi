from dataclasses import dataclass
from enum import StrEnum


class CmcErrorCode(StrEnum):
    HTTP = "http_error"
    AUTH = "authorization_failed"
    RATE_LIMIT = "rate_limited"
    PROVIDER = "provider_error"
    SCHEMA = "invalid_schema"
    MAPPING = "invalid_mapping"
    STORAGE = "storage_error"


@dataclass(frozen=True, slots=True)
class CmcError:
    code: CmcErrorCode
    message: str


__all__ = ["CmcErrorCode", "CmcError"]
