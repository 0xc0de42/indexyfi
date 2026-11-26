from datetime import UTC, date, datetime, timedelta
from typing import NotRequired, TypedDict

from aiohttp import web
from ind_assets.selected import SELECTED_ASSETS
from ind_cmc.collector import Cache
from ind_cmc.mapping import mapping_json
from ind_cmc.models import Mapping
from ind_cmc.serialization import history_json, quote_json
from ind_core.models import SelectedAsset


class AssetJson(TypedDict):
    asset_id: str
    symbol: str
    mapping: dict[str, object]


class QuoteJson(AssetJson):
    status: str
    quote: object
    error: NotRequired[str]


class HistorySeriesJson(AssetJson):
    status: str
    points: list[dict[str, object]]
    error: NotRequired[str]


def selected(request: web.Request) -> tuple[tuple[SelectedAsset, ...], tuple[str, ...]]:
    requested = request.query.getall("asset_id", [])
    known = {asset.asset_id.value for asset in SELECTED_ASSETS}
    unknown = tuple(dict.fromkeys(value for value in requested if value not in known))
    if unknown:
        return (), unknown
    wanted = frozenset(requested)
    assets = tuple(
        asset for asset in SELECTED_ASSETS if not wanted or asset.asset_id.value in wanted
    )
    return assets, ()


def mapping_by_asset(cache: Cache) -> dict[str, Mapping]:
    return {mapping.asset_id.value: mapping for mapping in cache.mappings}


def unknown_response(values: tuple[str, ...]) -> web.Response:
    return web.json_response({"error": "unknown_asset", "asset_ids": list(values)}, status=400)


def add_routes(
    app: web.Application, cache: Cache, history_days: int, history_max_query_days: int
) -> None:
    async def assets(request: web.Request) -> web.Response:
        if not cache.enabled:
            return web.json_response({"error": "cmc_disabled"}, status=503)
        chosen, unknown = selected(request)
        if unknown:
            return unknown_response(unknown)
        mappings = mapping_by_asset(cache)
        rows: list[AssetJson] = []
        for asset in chosen:
            mapping = mappings.get(asset.asset_id.value)
            if mapping is not None:
                rows.append(
                    {
                        "asset_id": asset.asset_id.value,
                        "symbol": asset.symbol,
                        "mapping": mapping_json(mapping),
                    }
                )
        return web.json_response({"assets": rows})

    async def latest_quotes(request: web.Request) -> web.Response:
        if not cache.enabled:
            return web.json_response({"error": "cmc_disabled"}, status=503)
        chosen, unknown = selected(request)
        if unknown:
            return unknown_response(unknown)
        mappings = mapping_by_asset(cache)
        rows: list[QuoteJson] = []
        for asset in chosen:
            mapping = mappings.get(asset.asset_id.value)
            if mapping is None:
                continue
            quote = cache.quotes.get(mapping.cmc_id)
            error = cache.quote_errors.get(mapping.cmc_id)
            row: QuoteJson = {
                "asset_id": asset.asset_id.value,
                "symbol": asset.symbol,
                "mapping": mapping_json(mapping),
                "status": (
                    "error" if error is not None else "pending" if quote is None else "available"
                ),
                "quote": quote_json(quote) if quote is not None else None,
            }
            if error is not None:
                row["error"] = error.code.value
            rows.append(row)
        return web.json_response({"source": "coinmarketcap", "quotes": rows})

    async def history(request: web.Request) -> web.Response:
        if not cache.enabled:
            return web.json_response({"error": "cmc_disabled"}, status=503)
        chosen, unknown = selected(request)
        if unknown:
            return unknown_response(unknown)
        try:
            today = datetime.now(UTC).date()
            end = date.fromisoformat(request.query.get("end", today.isoformat()))
            start = date.fromisoformat(
                request.query.get("start", (end - timedelta(days=history_days)).isoformat())
            )
            if (
                not timedelta(0) < end - start <= timedelta(days=history_max_query_days)
                or end > today
            ):
                raise ValueError("Invalid range")
        except (ValueError, OverflowError):
            return web.json_response({"error": "invalid_date_range"}, status=400)
        mappings = mapping_by_asset(cache)
        rows: list[HistorySeriesJson] = []
        for asset in chosen:
            mapping = mappings.get(asset.asset_id.value)
            if mapping is None:
                continue
            series = cache.history.get(mapping.cmc_id)
            error = cache.history_errors.get(mapping.cmc_id)
            points = (
                [history_json(point) for point in series.points if start <= point.day < end]
                if series is not None
                else []
            )
            row: HistorySeriesJson = {
                "asset_id": asset.asset_id.value,
                "symbol": asset.symbol,
                "mapping": mapping_json(mapping),
                "status": (
                    "error" if error is not None else "available" if points else "unavailable"
                ),
                "points": points,
            }
            if error is not None:
                row["error"] = error.code.value
            rows.append(row)
        return web.json_response(
            {
                "source": "coinmarketcap",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "series": rows,
            }
        )

    app.router.add_get("/v1/cmc/assets", assets)
    app.router.add_get("/v1/cmc/quotes", latest_quotes)
    app.router.add_get("/v1/cmc/history", history)


__all__ = [
    "AssetJson",
    "QuoteJson",
    "HistorySeriesJson",
    "selected",
    "mapping_by_asset",
    "add_routes",
]
