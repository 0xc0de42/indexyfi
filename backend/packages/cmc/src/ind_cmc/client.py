import asyncio
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum

import aiohttp
from ind_core.boundary import is_object
from returns.result import Failure, Result, Success

from ind_cmc.errors import CmcError, CmcErrorCode
from ind_cmc.models import Provenance

BASE_URL = "https://pro-api.coinmarketcap.com"


class Endpoint(StrEnum):
    MAP = "/v1/cryptocurrency/map"
    INFO = "/v2/cryptocurrency/info"
    QUOTES = "/v3/cryptocurrency/quotes/latest"
    HISTORY = "/v3/cryptocurrency/quotes/historical"
    RWA_MAP = "/v5/real-world-assets/map"
    RWA_QUOTES = "/v5/real-world-assets/quotes/latest"
    RWA_HISTORY = "/v5/real-world-assets/quotes/historical"


@dataclass(frozen=True, slots=True)
class Payload:
    data: object
    provenance: Provenance


def decode(
    body: bytes, endpoint: str, params: tuple[tuple[str, str], ...]
) -> Result[Payload, CmcError]:
    try:
        raw: object = json.loads(body, parse_float=Decimal)
    except (ValueError, UnicodeError):
        return Failure(CmcError(CmcErrorCode.SCHEMA, "Invalid JSON"))
    if not is_object(raw) or not is_object(status := raw.get("status")):
        return Failure(CmcError(CmcErrorCode.SCHEMA, "Missing provider status"))
    code = status.get("error_code")
    if not (type(code) is int and code == 0 or isinstance(code, str) and code == "0"):
        return Failure(CmcError(CmcErrorCode.PROVIDER, "Nonzero provider status"))
    credit = status.get("credit_count", 0)
    if type(credit) is not int or credit < 0 or "data" not in raw:
        return Failure(CmcError(CmcErrorCode.SCHEMA, "Invalid provider metadata"))
    provenance = Provenance(
        endpoint, datetime.now(UTC), hashlib.sha256(body).hexdigest(), params, credit
    )
    return Success(Payload(raw["data"], provenance))


class Client:
    def __init__(self, session: aiohttp.ClientSession, key: str, retries: int) -> None:
        self._session = session
        self._key = key
        self._retries = retries
        self._cooldown = 0.0
        self._next_request = 0.0
        self._lock = asyncio.Lock()

    async def get(self, endpoint: Endpoint, params: dict[str, str]) -> Result[Payload, CmcError]:
        async with self._lock:
            ordered = tuple(sorted(params.items()))
            for attempt in range(self._retries + 1):
                loop = asyncio.get_running_loop()
                due = max(self._cooldown, self._next_request)
                if due > loop.time():
                    await asyncio.sleep(due - loop.time())
                self._next_request = loop.time() + 1.5
                delay = float(2**attempt)
                error = CmcError(CmcErrorCode.HTTP, "CMC request failed")
                try:
                    async with self._session.get(
                        BASE_URL + endpoint.value,
                        params=params,
                        headers={"X-CMC_PRO_API_KEY": self._key, "Accept": "application/json"},
                        allow_redirects=False,
                    ) as response:
                        if response.status == 200:
                            return decode(await response.read(), endpoint.value, ordered)
                        if response.status in (401, 403):
                            return Failure(CmcError(CmcErrorCode.AUTH, "CMC access denied"))
                        if response.status == 429:
                            error = CmcError(CmcErrorCode.RATE_LIMIT, "CMC rate limited")
                            value = response.headers.get("Retry-After", "")
                            delay = max(
                                delay, float(min(int(value), 3600)) if value.isdecimal() else 60.0
                            )
                            self._cooldown = max(self._cooldown, loop.time() + delay)
                        elif response.status < 500:
                            return Failure(
                                CmcError(CmcErrorCode.HTTP, f"CMC HTTP {response.status}")
                            )
                except (aiohttp.ClientError, TimeoutError):
                    pass
                if attempt == self._retries:
                    return Failure(error)
                await asyncio.sleep(delay)
        raise AssertionError("Unreachable request loop")


__all__ = ["BASE_URL", "Endpoint", "Payload", "decode", "Client"]
