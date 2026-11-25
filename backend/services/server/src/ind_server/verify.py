import argparse
import asyncio
import json
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import TypedDict

from ind_assets.registry import load_candidates
from ind_atlas.collector import collect
from ind_config.loader import RuntimeConfig, load_config
from ind_core.models import FeedChannel, FeedId, PriceObservation, SelectedAsset
from returns.result import Failure, Result, Success


class VerifyErrorCode(StrEnum):
    CANDIDATES = "candidates_failed"
    NO_PRICES = "no_prices"
    INCOMPLETE = "incomplete_combined_subscription"
    WRITE = "write_failed"


@dataclass(frozen=True, slots=True)
class VerifyError:
    code: VerifyErrorCode
    message: str


class SelectedRow(TypedDict):
    asset_id: str
    symbol: str
    feed_id: int
    channel: str


async def observe(
    config: RuntimeConfig, assets: tuple[SelectedAsset, ...], seconds: float
) -> set[FeedId]:
    received: set[FeedId] = set()
    expected = {asset.feed_id for asset in assets}
    complete = asyncio.Event()

    def apply(batch: tuple[PriceObservation, ...]) -> None:
        received.update(p.feed_id for p in batch if p.feed_id in expected)
        if expected <= received:
            complete.set()

    task = asyncio.create_task(
        collect(config.atlas.ws.url, config.secrets.atlas_api_key, assets, apply)
    )
    ready = asyncio.create_task(complete.wait())
    try:
        done, _ = await asyncio.wait(
            (task, ready), timeout=seconds, return_when=asyncio.FIRST_COMPLETED
        )
        if task in done:
            match task.result():
                case Failure(error):
                    print(f"Probe: {error.code}: {error.message}")
    finally:
        task.cancel()
        ready.cancel()
        await asyncio.gather(task, ready, return_exceptions=True)
    return received


def _python_source(selected: tuple[SelectedAsset, ...]) -> str:
    lines = [
        '"""Generated verified Atlas selection. Do not edit by hand."""',
        "",
        "from ind_core.models import AssetId, FeedChannel, FeedId, SelectedAsset",
        "",
        "SELECTED_ASSETS: tuple[SelectedAsset, ...] = (",
    ]
    lines.extend(
        "    SelectedAsset("
        f"AssetId({asset.asset_id.value!r}), {asset.symbol!r}, FeedId({asset.feed_id.value}), "
        f"FeedChannel.{asset.channel.name}),"
        for asset in selected
    )
    lines.extend((")", "", '__all__ = ["SELECTED_ASSETS"]', ""))
    return "\n".join(lines)


def export_selection(
    manifest_path: Path, python_path: Path, selected: tuple[SelectedAsset, ...]
) -> Result[None, VerifyError]:
    rows: list[SelectedRow] = [
        {
            "asset_id": a.asset_id.value,
            "symbol": a.symbol,
            "feed_id": a.feed_id.value,
            "channel": a.channel.value,
        }
        for a in selected
    ]
    try:
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        python_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_temporary = manifest_path.with_suffix(".json.tmp")
        python_temporary = python_path.with_suffix(".py.tmp")
        manifest_temporary.write_text(
            json.dumps({"verified": True, "assets": rows}, indent=2) + "\n"
        )
        python_temporary.write_text(_python_source(selected))
        manifest_temporary.replace(manifest_path)
        python_temporary.replace(python_path)
        return Success(None)
    except OSError:
        return Failure(VerifyError(VerifyErrorCode.WRITE, "Could not export selected registry"))


async def verify(
    config: RuntimeConfig, seconds: float, batch_size: int
) -> Result[None, VerifyError]:
    match load_candidates(config.assets.candidates):
        case Failure(error):
            return Failure(VerifyError(VerifyErrorCode.CANDIDATES, error.message))
        case Success(candidates):
            pass
        case _:
            raise AssertionError("Unexpected Result variant")
    observed: dict[FeedId, FeedChannel] = {}
    for channel in FeedChannel:
        remaining = [c for c in candidates if c.feed_id not in observed]
        for offset in range(0, len(remaining), batch_size):
            group = remaining[offset : offset + batch_size]
            assets = tuple(SelectedAsset(c.asset_id, c.symbol, c.feed_id, channel) for c in group)
            found = await observe(config, assets, seconds)
            observed.update({a.feed_id: channel for a in assets if a.feed_id in found})
    selected: dict[str, SelectedAsset] = {}
    for c in sorted(
        candidates,
        key=lambda c: (
            c.pricing_plan,
            "VOLUME-WEIGHT" not in c.tags,
            "(S)" in c.feed_name,
            c.feed_id.value,
        ),
    ):
        if c.feed_id in observed and c.asset_id.value not in selected:
            selected[c.asset_id.value] = SelectedAsset(
                c.asset_id, c.symbol, c.feed_id, observed[c.feed_id]
            )
    combined = tuple(selected[key] for key in sorted(selected))
    unobserved = len({c.asset_id for c in candidates}) - len(combined)
    print(
        f"Observed {len(observed)} feeds; selected {len(combined)} assets; "
        f"{unobserved} unobserved assets"
    )
    if not combined:
        return Failure(
            VerifyError(VerifyErrorCode.NO_PRICES, "No verified prices; registry unchanged")
        )
    delivered = await observe(config, combined, seconds)
    if any(a.feed_id not in delivered for a in combined):
        return Failure(
            VerifyError(
                VerifyErrorCode.INCOMPLETE, "Combined subscription incomplete; registry unchanged"
            )
        )
    return export_selection(config.assets.registry, config.assets.python_module, combined)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path("config.toml"))
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--batch-size", type=int, default=72)
    args = parser.parse_args()
    path: object = args.config
    seconds: object = args.seconds
    batch_size: object = args.batch_size
    if (
        not isinstance(path, Path)
        or not isinstance(seconds, (int, float))
        or type(batch_size) is not int
        or seconds <= 0
        or batch_size <= 0
    ):
        parser.error("valid path, positive seconds and batch size required")
    match load_config(path):
        case Failure(error):
            raise SystemExit(f"{error.code}: {error.message}")
        case Success(config):
            match asyncio.run(verify(config, seconds, batch_size)):
                case Failure(error):
                    raise SystemExit(f"{error.code}: {error.message}")


__all__ = [
    "VerifyErrorCode",
    "VerifyError",
    "verify",
    "main",
]


if __name__ == "__main__":
    main()
