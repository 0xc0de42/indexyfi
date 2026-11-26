from datetime import UTC, date, datetime, timedelta

from aiohttp import web
from ind_assets.selected import SELECTED_ASSETS
from ind_cmc.collector import Cache
from ind_cmc.mapping import mapping_json
from ind_cmc.serialization import history_json, quote_json


def add_routes(app: web.Application, cache: Cache, history_days: int) -> None:
    async def metadata(request: web.Request) -> web.Response:
        if not cache.enabled:
            return web.json_response({"error": "cmc_disabled"}, status=503)
        mappings = {mapping.asset_id.value: mapping for mapping in cache.mappings}
        rows: list[dict[str, object]] = []
        for asset in SELECTED_ASSETS:
            row: dict[str, object] = {
                "asset_id": asset.asset_id.value,
                "symbol": asset.symbol,
                "mapping": None,
                "quote": None,
                "status": "unmapped",
            }
            mapping = mappings.get(asset.asset_id.value)
            if mapping is not None:
                quote = cache.quotes.get(mapping.cmc_id)
                error = cache.quote_errors.get(mapping.cmc_id)
                row["mapping"] = mapping_json(mapping)
                row["quote"] = quote_json(quote) if quote is not None else None
                row["status"] = (
                    "error" if error is not None else "pending" if quote is None else "available"
                )
                if error is not None:
                    row["error"] = error.code.value
            rows.append(row)
        return web.json_response(
            {"source": "coinmarketcap", "as_of": datetime.now(UTC).isoformat(), "assets": rows}
        )

    async def history(request: web.Request) -> web.Response:
        if not cache.enabled:
            return web.json_response({"error": "cmc_disabled"}, status=503)
        asset_id = request.query.get("asset_id", "")
        if asset_id not in {asset.asset_id.value for asset in SELECTED_ASSETS}:
            return web.json_response({"error": "unknown_asset"}, status=400)
        try:
            today = datetime.now(UTC).date()
            end = date.fromisoformat(request.query.get("end", today.isoformat()))
            start = date.fromisoformat(
                request.query.get("start", (end - timedelta(days=history_days)).isoformat())
            )
            if not timedelta(0) < end - start <= timedelta(days=history_days) or end > today:
                raise ValueError("Invalid range")
        except (ValueError, OverflowError):
            return web.json_response({"error": "invalid_date_range"}, status=400)
        for mapping in cache.mappings:
            if mapping.asset_id.value != asset_id:
                continue
            series = cache.history.get(mapping.cmc_id)
            if series is None:
                return web.json_response({"error": "history_not_available"}, status=503)
            points = [history_json(point) for point in series.points if start <= point.day < end]
            error = cache.history_errors.get(mapping.cmc_id)
            return web.json_response(
                {
                    "source": "coinmarketcap",
                    "mapping": mapping_json(mapping),
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "points": points,
                    "error": error.code.value if error is not None else None,
                }
            )
        return web.json_response({"error": "unmapped_asset"}, status=404)

    app.router.add_get("/market-metadata", metadata)
    app.router.add_get("/cmc/history", history)


__all__ = ["add_routes"]
