from collections.abc import Callable
from decimal import Decimal

from returns.maybe import Maybe, Some

from ind_cmc.models import DailyQuote, MarketQuote, Provenance


def optional[T](value: Maybe[T], encode: Callable[[T], str]) -> object:
    match value:
        case Some(item):
            return encode(item)
        case _:
            return None


def decimal(value: Maybe[Decimal]) -> object:
    return optional(value, lambda item: format(item, "f"))


def provenance_json(value: Provenance) -> dict[str, object]:
    return {
        "endpoint": value.endpoint,
        "fetched_at": value.fetched_at.isoformat(),
        "response_sha256": value.response_sha256,
        "parameters": dict(value.parameters),
        "credit_count": value.credit_count,
    }


def quote_json(value: MarketQuote) -> dict[str, object]:
    return {
        "cmc_id": value.cmc_id.value,
        "kind": value.cmc_id.kind.value,
        "timestamp": value.at.isoformat(),
        "price": decimal(value.price),
        "market_cap": decimal(value.market_cap),
        "volume_24h": decimal(value.volume_24h),
        "rank": value.rank.value_or(0) or None,
        "tags": list(value.tags),
        "percent_change_24h": decimal(value.change_24h),
        "percent_change_7d": decimal(value.change_7d),
        "percent_change_30d": decimal(value.change_30d),
        "percent_change_90d": decimal(value.change_90d),
        "provenance": provenance_json(value.provenance),
    }


def history_json(value: DailyQuote) -> dict[str, object]:
    return {
        "day": value.day.isoformat(),
        "timestamp": value.at.isoformat(),
        "price": decimal(value.price),
        "market_cap": decimal(value.market_cap),
        "volume_24h": decimal(value.volume_24h),
        "provenance": provenance_json(value.provenance),
    }


__all__ = ["optional", "decimal", "provenance_json", "quote_json", "history_json"]
