import json
from pathlib import Path

from ind_core.models import AssetId, SelectedAsset
from returns.result import Failure, Result, Success

from ind_cmc.errors import CmcError, CmcErrorCode
from ind_cmc.models import CmcAssetId, Kind, Mapping, Relation
from ind_cmc.parsers import Invalid, arr, integer, obj


def load(path: Path, assets: tuple[SelectedAsset, ...]) -> Result[tuple[Mapping, ...], CmcError]:
    try:
        raw: object = json.loads(path.read_text())
        known = {asset.asset_id.value for asset in assets}
        result: list[Mapping] = []
        seen: set[str] = set()
        for value in arr(obj(raw).get("mappings")):
            row = obj(value)
            asset = row.get("asset_id")
            kind, relation, evidence = row.get("kind"), row.get("relation"), row.get("evidence")
            if not isinstance(asset, str) or asset not in known or asset in seen:
                raise Invalid("Invalid asset mapping")
            if (
                not isinstance(kind, str)
                or not isinstance(relation, str)
                or not isinstance(evidence, str)
                or not evidence.strip()
            ):
                raise Invalid("Invalid mapping fields")
            cid = CmcAssetId(integer(row.get("cmc_id")), Kind(kind))
            rel = Relation(relation)
            if (cid.kind == Kind.RWA) != (rel == Relation.AGGREGATE):
                raise Invalid("Mapping relation does not match namespace")
            seen.add(asset)
            result.append(Mapping(AssetId(asset), cid, rel, evidence))
        return Success(tuple(result))
    except (OSError, ValueError):
        return Failure(CmcError(CmcErrorCode.MAPPING, "Cannot read valid CMC mappings"))


def mapping_json(mapping: Mapping) -> dict[str, object]:
    return {
        "asset_id": mapping.asset_id.value,
        "cmc_id": mapping.cmc_id.value,
        "kind": mapping.cmc_id.kind.value,
        "relation": mapping.relation.value,
        "evidence": mapping.evidence,
    }


__all__ = ["load", "mapping_json"]
