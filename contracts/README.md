# IndexFi contracts V5 — implementation candidate

This contracts-only update is based on `indexfi-source-2026-11-26.zip` and `CONTRACT_SPEC_V5.md`. It replaces the V1 non-transferable, profit-fee vault with a passive portfolio token on the standard OpenFour token inventory model. **The V5 Solidity sources have not been compiled or executed in this environment. Do not deploy until the gates below pass.** Backend and frontend are not modified. Legacy V1 manifests and documentation are archived, not active.

## First: compile and exercise local fixtures

```bash
cd contracts/openfour
npm ci
npm run compile
npm test
```

Solc 0.8.24 is taken from the locked npm dependency; optimizer 200, viaIR and Paris. The Hardhat tests use a local-only Core fixture with the actual standard OpenFour token/token module and migration library, a deterministic adapter for isolated accounting, and a constant-product V2 fixture for nonlinear execution. A fixture is not an official fork or actual PancakeSwap deployment.

To run an independent arithmetic model (no Solidity runtime): `python ../checks/accounting_model.py`.

For local manifest and ABI generation (only after compilation succeeds):

```bash
# terminal 1
npx hardhat node
# terminal 2
npx hardhat run scripts/deploy-indexfi.js --network localhost
```

The script writes V5 fixture-only `openfour/deployments/31337.json` and ABIs. It does not overwrite frontend files. Do not use the V1 ABI against the new contracts. The frontend needs the changes listed in `FRONTEND_HANDOFF.md`.

## Then: official Core compatibility experiment

Use your existing authorized local OpenFour Core/Registry instance (chain 31337), with matching fork manifest, signer and registry ownership, or reproduce the official developer-owned proxy deployment on a local fork. The upstream starter's `scripts/lib/demo.js` requires these bindings. Set a previously unused numeric `PRESET_ID`. No public chain writes are performed by the V5 experiment script.

```bash
export FORK_JSON=/absolute/path/to/local-fork.json
export PRESET_ID=1778027699999  # example only: choose unused preset ID
STEP=prepare npx hardhat run scripts/verify-indexfi-openfour.js --network localhost
# Read the factory address printed by prepare:
export INDEXFI_FACTORY=$(node -p 'require("./out/indexfi-v5-fork-fixture.json").factory')
PRESET=indexfi npx hardhat run scripts/register.js --network localhost
STEP=launch npx hardhat run scripts/verify-indexfi-openfour.js --network localhost
```

Set `CREATE_FEE_WEI` only to the actual required native fee. This experiment uses mock underlying pools and oracle, but the actual Core and registered standard token implementation if the provided local fork manifest is correct. It checks creator attribution, atomic launch, post-migration release/return, NAV and creator LP. Do not bypass phase errors or change the agreed model just to get a test to pass. Core could require additional launch constraints or not permit this atomic path; then adapt to the verified official lifecycle and obtain product approval for any change to atomicity. Record actual Core fees, registered bytecode/versions and results.

## Finally: real chain 97

The production-path `PancakeV2BasketAdapter` and `AtlasPushOracle` are implemented against V2 and Atlas single-feed interfaces. **No verified chain-97 asset addresses or oracle read entitlements are supplied.** Populate a copy of `chain97.config.example.json` with sponsor-confirmed addresses and feed-specific age policies. Run the read-only preflight:

```bash
cp chain97.config.example.json chain97.config.json
# edit with verified addresses; do not use mainnet token addresses
INDEXFI_CHAIN_CONFIG=chain97.config.json npx hardhat run scripts/preflight-indexfi.js --network bsctestnet
```

Preflight checks bytecode presence, chain, pool/route quotes and single-feed open-read freshness. It does not verify address provenance or execute swaps; whitelisted feeds require a separate authorization check. Only deploy real adapters, factory, register and generate chain-97 manifest after local/fork gates, actual assets/oracles/routes, mandatory fee review and explicit operator approval. No automated chain-97 deployment or signing service is included. Use the official OpenFour developer-owned deployment workflow and existing registration script. Never put Core's signer key in the browser or API repo. Public registration for this preset is gated by `INDEXFI_ALLOW_PUBLIC_REGISTRATION=1`.

## Source-level decisions

- `OpenFourToken`, `StandardTokenModule`, `PancakeV2MigrateLib` are byte-identical to the supplied baseline. The preset reuses the fork's token implementation and standard token module.
- Custom Curve/Trade reject Core bonding buys/sells; the intended launch migrates immediately, then all primary operations use the vault. Reusing a permissive existing Trade module would enable unsafe/unbacked presale paths. Core compatibility remains an experiment.
- Standard token totalSupply is the cap, not the backed outstanding supply; use `vault.outstandingSupply()`. Cap set in factory constructor (fixture value 1 billion whole shares). The V5 token is not a mint/burn token. Redemption requires ERC20 approval and returns shares to inventory. Direct unsolicited share transfers to the vault are not redemptions and remain counted as outstanding, potentially permanently stranded. Donations of collateral are not accounted and there is no sweep. These are explicit limitations of this branch; assess whether a minimal token extension is preferable after fork experiments.
- Creator seed is fee-free pending confirmation; public deposit and redemption fees fixed at 10 bps, including creator's own primary operations (fee paid back to creator). Native Core creation fee separate and not verified. No performance fee.
- NAV and collateralValue are USD/USDT 18-decimal units; USDT transfers use actual token base units. Oracle reads use a single verified price vector per deposit, not mutable AMM quotes. Redemption uses actual per-asset balances recorded by the vault, not untrusted donations or any oracle price.
- LP allocation backed and included in outstanding supply before migration; only reserved shares/USDT can move to the migration pair. V2 locked minimum LP means final closure can be unreachable, even after the creator removes all withdrawable liquidity. No privileged residual extraction.
- Only reviewed conventional non-rebasing/non-taxed ERC20s and approved oracle/DEX addresses are supported. No support for arbitrary tokens, multi-feed Atlas adapter, fee-on-transfer routes or chain-97 public launch yet.
