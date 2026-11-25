import json
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from ind_core.boundary import is_array, is_object
from ind_core.models import AssetId, FeedChannel, FeedId, SelectedAsset
from returns.result import Failure, Result, Success


class RegistryErrorCode(StrEnum):
    READ_FAILED = "read_failed"
    UNVERIFIED = "unverified"
    INVALID_RECORD = "invalid_record"
    DUPLICATE = "duplicate"


@dataclass(frozen=True, slots=True)
class RegistryError:
    code: RegistryErrorCode
    message: str


@dataclass(frozen=True, slots=True)
class Candidate:
    asset_id: AssetId
    symbol: str
    feed_id: FeedId
    feed_name: str
    pricing_plan: int
    tags: tuple[str, ...]


def _read(path: Path) -> Result[object, RegistryError]:
    try:
        raw: object = json.loads(path.read_text())
        return Success(raw)
    except (OSError, ValueError):
        return Failure(RegistryError(RegistryErrorCode.READ_FAILED, "Cannot read registry JSON"))


def _identity(item: object) -> Result[tuple[AssetId, str, FeedId], RegistryError]:
    error = RegistryError(RegistryErrorCode.INVALID_RECORD, "Invalid asset identity")
    if not is_object(item):
        return Failure(error)
    asset_id, symbol, feed_id = item.get("asset_id"), item.get("symbol"), item.get("feed_id")
    if (
        not isinstance(asset_id, str)
        or not asset_id
        or not isinstance(symbol, str)
        or not symbol
        or symbol.upper() == "USDC"
    ):
        return Failure(error)
    if type(feed_id) is not int or not 0 <= feed_id < 2**32:
        return Failure(error)
    return Success((AssetId(asset_id), symbol, FeedId(feed_id)))


def parse_registry(document: object) -> Result[tuple[SelectedAsset, ...], RegistryError]:
    if not is_object(document) or document.get("verified") is not True:
        return Failure(
            RegistryError(RegistryErrorCode.UNVERIFIED, "Registry has not been verified")
        )
    records = document.get("assets")
    invalid = RegistryError(RegistryErrorCode.INVALID_RECORD, "Invalid selected registry record")
    if not is_array(records) or not records:
        return Failure(invalid)
    assets: list[SelectedAsset] = []
    for item in records:
        if not is_object(item):
            return Failure(invalid)
        channel = item.get("channel")
        if channel not in ("public", "private") or not isinstance(channel, str):
            return Failure(invalid)
        match _identity(item):
            case Success((asset_id, symbol, feed_id)):
                assets.append(SelectedAsset(asset_id, symbol, feed_id, FeedChannel(channel)))
            case Failure(error):
                return Failure(error)
    if len({a.asset_id for a in assets}) != len(assets) or len({a.feed_id for a in assets}) != len(
        assets
    ):
        return Failure(RegistryError(RegistryErrorCode.DUPLICATE, "Duplicate asset or feed"))
    return Success(tuple(assets))


def load_registry(path: Path) -> Result[tuple[SelectedAsset, ...], RegistryError]:
    return _read(path).bind(parse_registry)


def parse_candidates(raw: object) -> Result[tuple[Candidate, ...], RegistryError]:
    invalid = RegistryError(RegistryErrorCode.INVALID_RECORD, "Invalid candidate registry record")
    if not is_array(raw) or not raw:
        return Failure(invalid)
    candidates: list[Candidate] = []
    for item in raw:
        if not is_object(item):
            return Failure(invalid)
        name, plan, tags = item.get("feed_name"), item.get("pricing_plan"), item.get("tags")
        if not isinstance(name, str) or type(plan) is not int or not is_array(tags):
            return Failure(invalid)
        strings: list[str] = []
        for tag in tags:
            if not isinstance(tag, str):
                return Failure(invalid)
            strings.append(tag)
        match _identity(item):
            case Success((asset_id, symbol, feed_id)):
                candidates.append(Candidate(asset_id, symbol, feed_id, name, plan, tuple(strings)))
            case Failure(error):
                return Failure(error)
    return Success(tuple(candidates))


def load_candidates(path: Path) -> Result[tuple[Candidate, ...], RegistryError]:
    return _read(path).bind(parse_candidates)


__all__ = [
    "RegistryErrorCode",
    "RegistryError",
    "Candidate",
    "load_registry",
    "parse_registry",
    "load_candidates",
    "parse_candidates",
]
