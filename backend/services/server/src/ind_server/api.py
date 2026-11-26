import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from aiohttp import web
from ind_cmc.collector import Cache as CmcCache
from ind_core.models import AssetId
from ind_history.parquet import MAX_HISTORY_RANGE, HistoryStore
from ind_snapshot.cache import LatestSnapshot
from returns.maybe import Maybe, Nothing, Some
from returns.result import Failure, Result, Success

from ind_server.cmc_api import add_routes as add_cmc_routes
from ind_server.serialization import HistoryJson, snapshot_json

access = logging.getLogger("http")


class ApiErrorCode(StrEnum):
    NOT_INITIALIZED = "not_initialized"
    INVALID_TIME_RANGE = "invalid_time_range"
    HISTORY_READ_FAILED = "history_read_failed"


@dataclass(frozen=True, slots=True)
class ApiError:
    code: ApiErrorCode
    message: str
    status: int

    def response(self) -> web.Response:
        return web.json_response({"error": self.code.value}, status=self.status)


@dataclass(frozen=True, slots=True)
class HistoryQuery:
    start: datetime
    end: datetime
    assets: frozenset[AssetId]


def parse_history_query(
    query: Mapping[str, str], asset_ids: list[str], now: datetime
) -> Result[HistoryQuery, ApiError]:
    error = ApiError(ApiErrorCode.INVALID_TIME_RANGE, "Invalid time range", 400)
    try:
        end = datetime.fromisoformat(query["end"]) if "end" in query else now
        start = (
            datetime.fromisoformat(query["start"])
            if "start" in query
            else end - timedelta(minutes=5)
        )
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            return Failure(error)
        start, end = start.astimezone(UTC), end.astimezone(UTC)
        if end - start > MAX_HISTORY_RANGE:
            return Failure(error)
        return Success(
            HistoryQuery(
                start,
                end,
                frozenset(AssetId(value) for value in asset_ids),
            )
        )
    except (ValueError, OverflowError):
        return Failure(error)


def make_app(
    latest: LatestSnapshot,
    history: HistoryStore,
    origin: str,
    cmc: Maybe[CmcCache] = Nothing,
    cmc_history_days: int = 30,
) -> web.Application:
    @web.middleware
    async def cors(
        request: web.Request, handler: Callable[[web.Request], Awaitable[web.StreamResponse]]
    ) -> web.StreamResponse:
        started = time.perf_counter()
        try:
            response = await handler(request)
        except web.HTTPException as error:
            access.debug("%s %s -> %d", request.method, request.path_qs, error.status)
            raise
        access.debug(
            "%s %s -> %d (%.1f ms)",
            request.method,
            request.path_qs,
            response.status,
            (time.perf_counter() - started) * 1000,
        )
        if request.headers.get("Origin") == origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        return response

    async def snapshot(request: web.Request) -> web.Response:
        match latest.latest():
            case Some(value):
                return web.json_response(snapshot_json(value))
            case _:
                return ApiError(
                    ApiErrorCode.NOT_INITIALIZED, "Cache not initialized", 503
                ).response()

    async def historical(request: web.Request) -> web.Response:
        match parse_history_query(
            request.query, request.query.getall("asset_id", []), datetime.now(UTC)
        ):
            case Failure(ApiError() as error):
                return error.response()
            case Success(query):
                match history.read(query.start, query.end, query.assets):
                    case Success(values):
                        body: HistoryJson = {"snapshots": [snapshot_json(v) for v in values]}
                        return web.json_response(body)
                    case Failure(_):
                        return ApiError(
                            ApiErrorCode.HISTORY_READ_FAILED, "History read failed", 500
                        ).response()
        raise AssertionError("Unexpected Result variant")

    app = web.Application(middlewares=[cors])
    app.router.add_get("/snapshot", snapshot)
    app.router.add_get("/history", historical)
    match cmc:
        case Some(cache):
            add_cmc_routes(app, cache, cmc_history_days)
    return app


__all__ = [
    "ApiErrorCode",
    "ApiError",
    "HistoryQuery",
    "parse_history_query",
    "make_app",
]
