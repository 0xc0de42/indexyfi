# IndexFi — Dynamic rebalancing: contracts and backend implementation plan

Date: 2026-11-26. Status: **plan**. The frontend is built against the interface below (`frontend/apps/web/lib/rebalance.ts`,
`lib/vaults.ts` → `rebalanceAbi` / `factoryRebalanceAbi`, `lib/keeper-api.ts`) and detects support at runtime, so it works
unchanged before and after these pieces ship.

## 1. Product rules

| Setting | Options | On-chain value |
|---|---|---|
| Rebalance interval | Off, 1 h, 3 h, 1 day, 3 days, 1 week | `interval` seconds: 0, 3600, 10800, 86400, 259200, 604800 |
| Drift threshold | 0.1%, 1%, 3%, 5% | `thresholdBps`: 10, 100, 300, 500 |

- Chosen by the creator at launch; **immutable** afterwards (Off is allowed). Any other value reverts at launch.
- **Drift** = max over constituents of |actual weight − target weight|, in basis points of portfolio value. Actual weights
  are holdings valued at fresh signed Atlas prices; targets are the launch `weightBps`.
- A rebalance is allowed when `interval > 0`, `now ≥ lastRebalanceAt + interval` (`lastRebalanceAt` starts at launch) and
  `drift ≥ thresholdBps`. The **interval is a minimum spacing**, not a schedule: the keeper checks every minute.
- A rebalance returns every constituent to its target weight in one transaction, through USDT, and reinvests all USDT.
  Supply, NAV accounting and the basket-token pool are unchanged except for swap fees (PancakeSwap 0.25% on traded value).
- **Permissionless:** anyone may call it; the contract enforces the rules, the keeper only pays gas.

## 2. Contracts (OpenFour IndexFi preset, vault 5.2.0 / factory 5.2.0)

### 2.1 Interface the frontend uses (keep exactly)

```solidity
struct RebalanceConfig { uint32 interval; uint16 thresholdBps; }

// IndexFiVault
function rebalanceConfig() external view returns (uint32 interval, uint16 thresholdBps, uint64 lastRebalanceAt);
/// eth_call only: posts the signed prices, then reports drift and the trade it would make.
function quoteRebalanceWithPrices(bytes[] calldata payloads, bytes[] calldata signatures)
    external returns (uint256 driftBps, bool due, uint256[] memory expectedOut);
function rebalanceWithPrices(bytes[] calldata payloads, bytes[] calldata signatures, uint256[] calldata minOut, uint256 deadline)
    external returns (uint256 navBefore, uint256 navAfter);
event Rebalanced(address indexed caller, uint256 driftBps, uint256 navBefore, uint256 navAfter, uint64 at);
error RebalanceDisabled(); error RebalanceNotDue(uint64 eligibleAt); error DriftBelowThreshold(uint256 driftBps);
error RebalanceLossExceeded(uint256 navBefore, uint256 navAfter);

// IndexFiFactory — same as today plus a trailing `RebalanceConfig rebalance` argument
function createVaultWithPrices(bytes[] payloads, bytes[] signatures, uint256 requestId, Basket basket, uint256 seedUSDT,
    uint256 liquidityUSDT, uint256 minCreatorShares, uint256[] minTokenOut, uint256 deadline, bytes launchAuthorization,
    RebalanceConfig rebalance) payable returns (address vault, uint256 seedShares);
function buildCreateArgs(uint256 requestId, address creator, Basket basket, uint256 seedUSDT, uint256 liquidityUSDT,
    uint256 minCreatorShares, uint256[] minimums, uint256 deadline, uint256 createFee, RebalanceConfig rebalance)
    view returns (bytes);   // config is inside createArgs, so the OpenFour launch signature covers it
```

`expectedOut[i]` is the expected output of constituent i's leg (USDT for a sell, asset units for a buy, 0 for no trade);
callers pass `minOut[i] = expectedOut[i] × (1 − slippage)`. Order: sells first, then buys.

### 2.2 Vault changes (`modules/vault/IndexFiVault.sol`)
1. Store `RebalanceConfig` + `lastRebalanceAt` (one slot: uint32 + uint16 + uint64), decoded from `LaunchConfig` in `seed`.
   Validate the config against the allowed sets; `lastRebalanceAt = block.timestamp` at seed.
2. `_drift(prices)`: value v_i = balance_i × p_i / unit_i, V = Σ v_i, w_i = v_i × 10,000 / V; drift = max |w_i − target_i|.
3. `rebalanceWithPrices`: `_postPrices` (≤ 4 payloads, as deposits) → `active` + `nonReentrant` → checks in §1 →
   compute target value t_i = V × target_i / 10,000 → sell (v_i − t_i) for every overweight leg via the adapter
   (minOut enforced) → buy every underweight leg with its share of the USDT proceeds, the last buy taking the remainder so no
   USDT stays in the vault → `navAfter = _value(prices)`; revert `RebalanceLossExceeded` if
   `navAfter < navBefore × (10,000 − MAX_REBALANCE_LOSS_BPS) / 10,000` with `MAX_REBALANCE_LOSS_BPS = 100`
   → `lastRebalanceAt = now`; emit `Rebalanced`.
4. `quoteRebalanceWithPrices`: same maths with `adapter.quoteSell/quoteBuy`, no state change besides the oracle update.
5. Optional (if bytecode allows): deposits allocate toward **target** weights instead of current ones, reducing drift for free.
6. **Size budget:** vault is 20,236 / 24,576 bytes. If it does not fit, move `_drift` and the trade sizing into an internal
   library (`RebalanceMath`), keep swaps in the vault. Do not give an external contract custody of vault assets.

### 2.3 Factory
Carry `RebalanceConfig` through `createVaultWithPrices`, `createVault`, `buildCreateArgs` and `LaunchConfig`; bump version.

### 2.4 Tests (`contracts/openfour/test/IndexFi.rebalance.test.js`)
- Launch with each interval/threshold; invalid values revert; Off never rebalances.
- Not due before `lastRebalanceAt + interval` (`RebalanceNotDue`), below threshold (`DriftBelowThreshold`), due → weights
  within 1 bp + rounding of target, no USDT left, `Rebalanced` emitted, `lastRebalanceAt` updated.
- Manipulated pool (price moved vs Atlas) → `RebalanceLossExceeded`; stale/invalid signed prices revert as in deposits.
- Deposits/redeems/in-kind unaffected; supply unchanged; 14- and 32-asset gas with explicit limits (< 16M cap).
- `quoteRebalanceWithPrices` matches execution.

### 2.5 Deploy (chain 97, operator script in `dump/preset-ready`)
Bump vault/factory/migrate-binding versions in `deploy/97.config.json` → new preset id → `deploy.cjs` reuses the 66 assets,
pools, oracle and adapter → relaunch the five baskets with configs (e.g. CORE14 1 day / 1%, others varied for the demo) →
export manifest with `"features": {"rebalancing": true}` → frontend switches to the new create ABI automatically.

## 3. Backend: rebalance keeper

A **separate process** (`backend/services/keeper`), not the price server: it holds a signing key, the API server must not.

1. **Config** (`config.toml` `[keeper]`): `enabled`, `rpc_urls` (chain 97 list), `factory`, `scan_seconds = 60`,
   `slippage_bps = 100`, `max_gas = 12_000_000`, `realign_testnet_pools = true` (chain 97 only). Secrets in `.env`:
   `IND_KEEPER_PRIVATE_KEY` (operator or dedicated keeper wallet), Atlas key reused for signed prices.
2. **Loop (every 60 s):** list vaults (`vaultCount`/`vaultAt`) → read `rebalanceConfig()` (skip on revert: pre-5.2 vault) →
   skip Off / not due (pure time check) → fetch one signed Atlas payload per ≤ 20 feeds → `eth_call quoteRebalanceWithPrices`
   → if `due`, (chain 97: realign the traded constituent pools to Atlas first, as `scripts/realign-pools.cjs`) → simulate →
   send `rebalanceWithPrices` with explicit gas (`gasLimit` rule: estimate +20%, else 600k + 260k/leg) → wait for receipt.
   One vault at a time, nonce managed locally, at most one pending transaction.
3. **Failure handling:** revert reasons mapped to states (`not_due`, `below_threshold`, `loss_exceeded`, `failed`); a failed
   vault backs off to its next interval; RPC failover across the list; never retries a reverted call in a tight loop.
4. **HTTP status (read-only), served by the price server from a status file the keeper writes atomically:**

```
GET /v1/rebalancer/status[?vault=0x…]   200 {"updated_at": ISO8601, "vaults": [{
  "vault": "0x…", "interval_seconds": 86400, "threshold_bps": 100,
  "drift_bps": "37.5" | null, "last_rebalance_at": ISO8601 | null, "next_eligible_at": ISO8601 | null,
  "last_scan_at": ISO8601 | null,
  "state": "disabled" | "waiting" | "below_threshold" | "due" | "submitted" | "failed",
  "last_tx": "0x…" | null, "error": "string" | null }]}
503 {"error": "keeper_disabled"}
```
   The frontend shows this as keeper status only; drift, schedule and history come from chain + Atlas.
5. **Tests:** unit tests for the eligibility/time logic, payload chunking, revert mapping and status serialization; an
   integration test against a local Hardhat chain with the 5.2 contracts (due → rebalanced; not due → no tx).
6. **Ops:** run beside the price server; log every decision; alert on `failed`; the keeper wallet needs tBNB
   (~0.001 tBNB per 13-asset rebalance at 0.1 gwei).

## 4. Rollout order and acceptance
1. Contracts + tests (§2.4) → 2. local keeper integration test → 3. chain-97 redeploy + relaunch (§2.5) → 4. keeper on
   chain 97 → 5. frontend already live: Review step stores settings; portfolio page shows drift, schedule, keeper state and
   history; "Rebalance now" works for anyone when due.

Acceptance: a basket set to 1 h / 0.1% rebalances within ~1 minute of becoming due; weights return to target within
rounding; NAV loss ≤ fees and never > 1%; a not-due or below-threshold call reverts; pre-5.2 vaults keep working.
