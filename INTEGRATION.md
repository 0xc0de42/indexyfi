# IndexFi V5 — integrated source handoff

## Source baseline

Original `indexfi-source-2026-11-26.zip` frontend/backend plus `INDEXFI_CONTRACTS_V5_IMPLEMENTATION.zip`. Production contracts remain unchanged from that delivery; only the local `MockV2.sol` fixture gains V2 `getReserves`, `addLiquidity`, and `removeLiquidity`. Upstream OpenFour token, TokenModule and migration library are unchanged. No secrets or stale V1 active manifests are distributed. Old documentation and archived V1 fixtures are historical; this file supersedes them for integration.

## Architecture

- Backend: existing Atlas WS -> latest snapshot / minute Parquet -> GET `/snapshot`, GET `/history`. Same schema, no signer or transaction execution, no new endpoint. Maximum history request 24h enforced server and store; sparse reads scan existing UTC hour directories. No change to WS behavior, registry or config semantics.
- Frontend: same-origin `/backend` proxy, existing 66-asset reference registry, local charts and wallet integration. Chain-dependent executable assets are mapped by canonical reference ID plus feed ID, not ticker. V5 manifest validates chain, fixture mode, token decimals, and factory bindings. The UI reads backed outstanding supply, accounted holdings, transferable token balances, oracle NAV/AUM, AMM reserves/LP balances; unavailable oracle valuation is separate from redemption. Creation has independent seed and liquidity, initial seed fee-free, estimated creator tokens, slippage and receipt-based discovery. Deposits and redemptions charge fixed 10 bps; secondary trades and liquidity are independent router calls. The creator and other LP holders can add/remove liquidity. No cost basis or performance fee.
- Contracts: standard OpenFour token inventory model, current-weight deposits, proportional redemptions, custom migration with separate LP reserves. Local fixture Core and oracle are not official testnet deployments; displayed fixture execution prices are distinct from live backend reference prices.

## Install and verify

Requires Python 3.12, uv, Node 22 (or supported Node >=20.9), Corepack/pnpm 10.12.1, npm, and dependency download access. From repository root:

```sh
bash integration/check.sh
```

This runs the actual backend lint/type/tests, contract compile/tests, frontend registry/type/tests/build. Do not treat a failed or skipped check as a pass.

## Local run (three services)

1. In terminal A:

```sh
cd contracts/openfour
npm ci
npm run compile
npx hardhat node
```

2. In another terminal, from repository root:

```sh
(cd contracts/openfour && npx hardhat run scripts/deploy-indexfi.js --network localhost)
node integration/sync-deployment.mjs 31337
```

The contract deployment script creates local fixture assets, oracle, router, Core, factory and funded creator/investor accounts. It emits the actual manifest and compiled ABIs. The sync script rejects legacy or wrong-chain metadata, validates feed mapping and checks required compiled ABI fields. Repeat after restarting the disposable Hardhat node. Never reuse stale local addresses.

3. Terminal B:

```sh
cd backend
uv sync --all-packages --locked
cp .env.example .env # only if not already configured
# Set IND_ATLAS_API_KEY in .env locally (do not commit).
uv run python -m ind_server --config config.toml
```

Wait for a complete snapshot, then verify `curl http://127.0.0.1:8000/snapshot`. The live price service intentionally does not fabricate prices when the WS is unavailable. The same-origin proxy avoids direct browser CORS problems; the existing configurable direct origin is unchanged.

4. Terminal C (from repository root):

```sh
cd frontend
corepack pnpm install --frozen-lockfile
NEXT_PUBLIC_VAULT_CHAIN_ID=31337 NEXT_PUBLIC_VAULT_RPC_URL=http://127.0.0.1:8545 PYTHON_API_URL=http://127.0.0.1:8000 corepack pnpm dev
```

Open `http://127.0.0.1:3000`. In a disposable wallet profile connect to local chain 31337 and use a funded local fixture account from the deployment manifest/Hardhat node. Do not reuse local test keys on public chains. Create with 100 USDT collateral and 10 USDT liquidity; then inspect portfolio, deposit, redeem, trade and manage LP. The fixture token only supports ETH/BTCB in the supplied deployment script. Historical data depends on actual observed samples.

## Cross-service smoke (opt-in; modifies only local fixture state)

With all three services running and Atlas snapshot initialized, run from root:

```sh
bash integration/smoke.sh
```

The Vitest smoke uses the frontend ABI and quote helpers against local RPC, real backend through Next proxy, actual receipt event, transfer, deposits/redemptions, buy/sell, add/remove LP. It checks asset-feed parity, oracle NAV, migrated phase, LP accounting and supply invariants. It is not a browser automation test and does not exercise wallet extension interactions. Also run `cd frontend && INDEXFI_PROXY_URL=http://127.0.0.1:3000/backend corepack pnpm test:live` for direct/proxy HTTP tests. A live key is needed for the backend smoke; do not include it in source or frontend config.

## Full local E2E (one command)

`integration/run.mjs` starts a disposable stack on ports 18545/18000/13000 (Hardhat node, fixture deploy, manifest sync, production market server fed by synthetic Atlas frames via `integration/market_fixture.py`, Next.js), drives the UI in headless Chrome (create, deposit, full redeem with exact 10 bps fee checks, directory), then runs the V5 smoke above against the same stack. No Atlas key is needed.

```sh
cd integration && npm ci && npm test
```

## Chain 97

No verified deployment is supplied. First pass official OpenFour compatibility tests, verify real oracle feeds and DEX routes, register authorized preset and obtain launch authorization, verify fees, generate chain-97 manifest and compiled ABIs, synchronize with `node integration/sync-deployment.mjs 97`. The public launch UI intentionally disables create until the signed payload workflow is integrated; the local fixture's empty signature is never sent to chain 97. Existing portfolio actions use verified configured deployment. Do not treat local Core as real OpenFour or mock assets as actual RWA.

## Scope and remaining work

Compilation, typecheck, the Python quality gate, browser E2E and the V5 smoke have been executed and pass (see `VALIDATION_V5.md`). Official Core compatibility and public testnet are not established. UI uses reserve-ratio LP quotes and caps slippage at 10%; launch defaults to 1% slippage. Direct LP addition assumes a nonempty reserve pair. Portfolio transfer is standard ERC-20 wallet operation, not a dedicated transfer screen. Historical portfolio NAV, event indexing and public signer service are deferred. See `VALIDATION_V5.md` for actual executed checks.
