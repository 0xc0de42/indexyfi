# Registry
`candidates.json` is generated from the supplied catalog, not a verified live registry.
Run `uv run python -m ind_server.verify --seconds 60` from backend to observe both
public and private candidates, then generate `selected.json` and the finalized
`ind_assets.selected` Python module. The live server imports that Python module.
The frontend registry generator uses the JSON handoff plus catalog metadata to
produce its finalized `registry.generated.ts`; the frontend imports that TypeScript
module. Neither runtime reads these dumps or the JSON handoff. Observed feeds are
evidence of access in that test window, not a promise of immediate delivery on future
connections. Unobserved feeds remain unknown. Review excluded assets and rerun with a
longer window before using the result.

`cmc.json` is a separate, operator-approved mapping from canonical `asset_id` to a CMC crypto or
RWA identity. It intentionally starts empty. Never enable a candidate from ticker equality alone:
record the relation (`exact_token`, `underlying_reference`, or `rwa_aggregate`) and nonempty
evidence. Missing mappings are valid and remain visible as unavailable metadata.
