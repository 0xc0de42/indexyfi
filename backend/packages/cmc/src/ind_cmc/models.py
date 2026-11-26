from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from ind_core.models import AssetId
from returns.maybe import Maybe


class Kind(StrEnum):
    CRYPTO = "crypto"
    RWA = "rwa"


class Relation(StrEnum):
    EXACT = "exact_token"
    REFERENCE = "underlying_reference"
    AGGREGATE = "rwa_aggregate"


@dataclass(frozen=True, slots=True)
class CmcAssetId:
    value: int
    kind: Kind


@dataclass(frozen=True, slots=True)
class Mapping:
    asset_id: AssetId
    cmc_id: CmcAssetId
    relation: Relation
    evidence: str


@dataclass(frozen=True, slots=True)
class Provenance:
    endpoint: str
    fetched_at: datetime
    response_sha256: str
    parameters: tuple[tuple[str, str], ...]
    credit_count: int


@dataclass(frozen=True, slots=True)
class MarketQuote:
    cmc_id: CmcAssetId
    at: datetime
    price: Maybe[Decimal]
    market_cap: Maybe[Decimal]
    volume_24h: Maybe[Decimal]
    rank: Maybe[int]
    tags: tuple[str, ...]
    change_24h: Maybe[Decimal]
    change_7d: Maybe[Decimal]
    change_30d: Maybe[Decimal]
    change_90d: Maybe[Decimal]
    provenance: Provenance


@dataclass(frozen=True, slots=True)
class DailyQuote:
    cmc_id: CmcAssetId
    day: date
    at: datetime
    price: Maybe[Decimal]
    market_cap: Maybe[Decimal]
    volume_24h: Maybe[Decimal]
    provenance: Provenance


__all__ = [
    "Kind",
    "Relation",
    "CmcAssetId",
    "Mapping",
    "Provenance",
    "MarketQuote",
    "DailyQuote",
]
