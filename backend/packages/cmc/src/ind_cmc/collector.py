import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Protocol

from returns.maybe import Some
from returns.result import Failure, Result, Success

from ind_cmc.client import Endpoint, Payload
from ind_cmc.errors import CmcError, CmcErrorCode
from ind_cmc.models import CmcAssetId, Kind, Mapping, MarketQuote
from ind_cmc.parsers import historical, quotes
from ind_cmc.storage import Series, Store

log = logging.getLogger("cmc")


class Provider(Protocol):
    async def get(
        self, endpoint: Endpoint, params: dict[str, str]
    ) -> Result[Payload, CmcError]: ...


@dataclass(frozen=True, slots=True)
class Policy:
    quote_seconds: int = 900
    history_days: int = 30
    history_max_query_days: int = 365
    history_delay_seconds: int = 600


class Cache:
    def __init__(self, mappings: tuple[Mapping, ...] = (), *, enabled: bool = False) -> None:
        self.mappings = mappings
        self.enabled = enabled
        self.quotes: dict[CmcAssetId, MarketQuote] = {}
        self.history: dict[CmcAssetId, Series] = {}
        self.quote_errors: dict[CmcAssetId, CmcError] = {}
        self.history_errors: dict[CmcAssetId, CmcError] = {}

    def ids(self, kind: Kind) -> tuple[CmcAssetId, ...]:
        return tuple(
            sorted(
                {mapping.cmc_id for mapping in self.mappings if mapping.cmc_id.kind == kind},
                key=lambda item: item.value,
            )
        )


def hydrate(cache: Cache, store: Store) -> None:
    """Load every approved persisted series without requiring provider access."""
    for kind in Kind:
        for cid in cache.ids(kind):
            match store.read(cid):
                case Failure(CmcError() as error):
                    cache.history_errors[cid] = error
                case Success(series):
                    cache.history[cid] = series


async def poll_quotes(client: Provider, cache: Cache, kind: Kind) -> None:
    ids = cache.ids(kind)
    for offset in range(0, len(ids), 250):
        batch = ids[offset : offset + 250]
        endpoint = Endpoint.QUOTES if kind == Kind.CRYPTO else Endpoint.RWA_QUOTES
        key = "id" if kind == Kind.CRYPTO else "rwa_id"
        params = {
            key: ",".join(str(cid.value) for cid in batch),
            "convert": "USD",
            "skip_invalid": "true",
        }
        match await client.get(endpoint, params):
            case Failure(CmcError() as error):
                for cid in batch:
                    cache.quote_errors[cid] = error
            case Success(payload):
                match quotes(payload, kind, frozenset(cid.value for cid in batch)):
                    case Failure(CmcError() as error):
                        for cid in batch:
                            cache.quote_errors[cid] = error
                    case Success(values):
                        seen = {value.cmc_id for value in values}
                        for cid in batch:
                            if cid not in seen:
                                cache.quote_errors[cid] = CmcError(
                                    CmcErrorCode.SCHEMA, "Quote missing"
                                )
                        for value in values:
                            cache.quotes[value.cmc_id] = value
                            cache.quote_errors.pop(value.cmc_id, None)


def completed_end(now: datetime, delay_seconds: int) -> date:
    return (now.astimezone(UTC) - timedelta(seconds=delay_seconds)).date()


def request_start(series: Series, end: date, initial_days: int, max_days: int) -> date:
    match series.last_day:
        case Some(date() as last):
            first = last + timedelta(days=1)
        case _:
            first = end - timedelta(days=initial_days)
    return max(first, end - timedelta(days=max_days))


async def refresh_history(
    client: Provider, cache: Cache, store: Store, kind: Kind, end: date, policy: Policy
) -> None:
    ids = cache.ids(kind)
    groups: dict[date, list[CmcAssetId]] = {}
    for cid in ids:
        if cid not in cache.history:
            match store.read(cid):
                case Failure(CmcError() as error):
                    cache.history_errors[cid] = error
                    continue
                case Success(series):
                    cache.history[cid] = series
        start = request_start(
            cache.history[cid], end, policy.history_days, policy.history_max_query_days
        )
        if start < end:
            groups.setdefault(start, []).append(cid)
    for start, group in sorted(groups.items()):
        endpoint = Endpoint.HISTORY if kind == Kind.CRYPTO else Endpoint.RWA_HISTORY
        key = "id" if kind == Kind.CRYPTO else "rwa_id"
        params = {
            key: ",".join(str(cid.value) for cid in group),
            "interval": "daily",
            "convert": "USD",
            # CMC daily intervals begin after the supplied boundary. Request the
            # preceding boundary, then let the parser enforce [start, end).
            "time_start": (start - timedelta(days=1)).isoformat(),
            "time_end": (end - timedelta(days=1)).isoformat(),
            "skip_invalid": "true",
        }
        match await client.get(endpoint, params):
            case Failure(CmcError() as error):
                for cid in group:
                    cache.history_errors[cid] = error
            case Success(payload):
                match historical(payload, kind, frozenset(cid.value for cid in group), start, end):
                    case Failure(CmcError() as error):
                        for cid in group:
                            cache.history_errors[cid] = error
                    case Success(values):
                        for cid in group:
                            own = tuple(value for value in values if value.cmc_id == cid)
                            if not own:
                                cache.history_errors[cid] = CmcError(
                                    CmcErrorCode.SCHEMA, "History missing"
                                )
                                continue
                            updated = cache.history[cid].merge(own)
                            match store.write(cid, updated):
                                case Failure(CmcError() as error):
                                    cache.history_errors[cid] = error
                                case Success(_):
                                    cache.history[cid] = updated
                                    cache.history_errors.pop(cid, None)


async def collect(client: Provider, cache: Cache, store: Store, policy: Policy) -> None:
    async def quote_loop() -> None:
        while True:
            await poll_quotes(client, cache, Kind.CRYPTO)
            await poll_quotes(client, cache, Kind.RWA)
            await asyncio.sleep(policy.quote_seconds)

    async def history_loop() -> None:
        while True:
            end = completed_end(datetime.now(UTC), policy.history_delay_seconds)
            await refresh_history(client, cache, store, Kind.CRYPTO, end, policy)
            await refresh_history(client, cache, store, Kind.RWA, end, policy)
            next_at = datetime.combine(end + timedelta(days=1), time.min, tzinfo=UTC) + timedelta(
                seconds=policy.history_delay_seconds
            )
            await asyncio.sleep(max(1.0, (next_at - datetime.now(UTC)).total_seconds()))

    async with asyncio.TaskGroup() as group:
        group.create_task(quote_loop())
        group.create_task(history_loop())


__all__ = [
    "Policy",
    "Provider",
    "Cache",
    "poll_quotes",
    "completed_end",
    "request_start",
    "hydrate",
    "refresh_history",
    "collect",
]
