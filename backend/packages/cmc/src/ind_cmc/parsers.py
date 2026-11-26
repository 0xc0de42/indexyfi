from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation

from ind_core.boundary import is_array, is_object
from returns.maybe import Maybe, Nothing, Some
from returns.result import Failure, Result, Success

from ind_cmc.client import Payload
from ind_cmc.errors import CmcError, CmcErrorCode
from ind_cmc.models import CmcAssetId, DailyQuote, Kind, MarketQuote


class Invalid(ValueError):
    """Internal parsing failure; public parsers return typed errors."""


def obj(value: object) -> dict[str, object]:
    if not is_object(value):
        raise Invalid("Expected object")
    return value


def arr(value: object) -> list[object]:
    if not is_array(value):
        raise Invalid("Expected array")
    return value


def integer(value: object) -> int:
    if type(value) is not int or value <= 0:
        raise Invalid("Invalid positive integer")
    return value


def timestamp(value: object) -> datetime:
    if not isinstance(value, str):
        raise Invalid("Invalid timestamp")
    at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if at.tzinfo is None:
        raise Invalid("Missing timezone")
    return at.astimezone(UTC)


def number(value: object, *, signed: bool = False) -> Maybe[Decimal]:
    if value is None:
        return Nothing
    if not isinstance(value, (int, Decimal, float, str)) or isinstance(value, bool):
        raise Invalid("Invalid decimal")
    result = Decimal(str(value))
    if not result.is_finite() or (not signed and result < 0):
        raise Invalid("Invalid decimal range")
    return Some(result)


def optional_rank(value: object) -> Maybe[int]:
    return Nothing if value is None or value == 0 else Some(integer(value))


def quotes(
    payload: Payload, kind: Kind, ids: frozenset[int]
) -> Result[tuple[MarketQuote, ...], CmcError]:
    try:
        rows = arr(payload.data if kind == Kind.CRYPTO else obj(payload.data).get("rwa_assets"))
        result: list[MarketQuote] = []
        seen: set[int] = set()
        for value in rows:
            row = obj(value)
            cid = integer(row.get("id" if kind == Kind.CRYPTO else "rwa_id"))
            if cid not in ids or cid in seen:
                raise Invalid("Unexpected or duplicate CMC ID")
            seen.add(cid)
            candidates = [
                obj(item) for item in arr(row.get("quote" if kind == Kind.CRYPTO else "quotes"))
            ]
            currency_key = "id" if kind == Kind.CRYPTO else "crypto_id"
            usd = [
                item
                for item in candidates
                if item.get(currency_key) == 2781 and item.get("symbol") == "USD"
            ]
            if len(usd) != 1:
                raise Invalid("Expected one USD quote")
            quote = usd[0]
            tags: list[str] = []
            if kind == Kind.CRYPTO:
                for tag in arr(row.get("tags", [])):
                    slug = obj(tag).get("slug")
                    if not isinstance(slug, str):
                        raise Invalid("Invalid tag")
                    tags.append(slug)
            elif isinstance(asset_type := row.get("asset_type"), str):
                tags.append(asset_type)
            prefix = "" if kind == Kind.CRYPTO else "tokenized_"
            result.append(
                MarketQuote(
                    CmcAssetId(cid, kind),
                    timestamp(quote.get("last_updated")),
                    number(
                        quote.get("price" if kind == Kind.CRYPTO else "average_tokenized_price")
                    ),
                    number(quote.get(prefix + "market_cap")),
                    number(quote.get(prefix + "volume_24h")),
                    optional_rank(row.get("cmc_rank" if kind == Kind.CRYPTO else "rwa_rank")),
                    tuple(sorted(set(tags))),
                    number(quote.get("percent_change_24h"), signed=True),
                    number(quote.get("percent_change_7d"), signed=True),
                    number(quote.get("percent_change_30d"), signed=True),
                    number(quote.get("percent_change_90d"), signed=True),
                    payload.provenance,
                )
            )
        return Success(tuple(result))
    except (ValueError, InvalidOperation, OverflowError):
        return Failure(CmcError(CmcErrorCode.SCHEMA, "Invalid latest quotes response"))


def historical(
    payload: Payload, kind: Kind, ids: frozenset[int], start: date, end: date
) -> Result[tuple[DailyQuote, ...], CmcError]:
    try:
        source = obj(payload.data)
        rows = (
            obj(source).items()
            if kind == Kind.CRYPTO
            else ((str(integer(obj(v).get("rwa_id"))), v) for v in arr(source.get("rwa_assets")))
        )
        result: list[DailyQuote] = []
        seen: set[tuple[int, date]] = set()
        for key, value in rows:
            row = obj(value)
            cid = integer(row.get("id" if kind == Kind.CRYPTO else "rwa_id"))
            if key != str(cid) or cid not in ids:
                raise Invalid("Unexpected historical identity")
            for raw_quote in arr(row.get("quotes")):
                point = obj(raw_quote)
                if kind == Kind.CRYPTO:
                    at = timestamp(point.get("timestamp"))
                    usd = obj(obj(point.get("quote")).get("USD"))
                    provider_at = timestamp(usd.get("timestamp", point.get("timestamp")))
                    price, market_cap, volume = (
                        usd.get("price"),
                        usd.get("market_cap"),
                        usd.get("volume_24h"),
                    )
                else:
                    if point.get("convert_id") != 2781 or point.get("convert_symbol") != "USD":
                        raise Invalid("Expected USD RWA point")
                    at = timestamp(point.get("timestamp"))
                    provider_at = at
                    price = point.get("average_tokenized_price")
                    market_cap = point.get("tokenized_market_cap")
                    volume = point.get("tokenized_volume_24h")
                day = at.date()
                identity = (cid, day)
                if not start <= day < end or identity in seen:
                    raise Invalid("Invalid historical day")
                seen.add(identity)
                result.append(
                    DailyQuote(
                        CmcAssetId(cid, kind),
                        day,
                        provider_at,
                        number(price),
                        number(market_cap),
                        number(volume),
                        payload.provenance,
                    )
                )
        return Success(tuple(sorted(result, key=lambda item: (item.cmc_id.value, item.day))))
    except (ValueError, InvalidOperation, OverflowError):
        return Failure(CmcError(CmcErrorCode.SCHEMA, "Invalid historical quotes response"))


__all__ = ["Invalid", "obj", "arr", "integer", "timestamp", "number", "quotes", "historical"]
