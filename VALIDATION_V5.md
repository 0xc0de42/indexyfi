# Integration validation — 2026-11-26

## Executed on `feat/graduation` (full toolchain, hardened contracts)

All gates below ran against the installed dependencies and passed:

- Contracts: `npx hardhat compile` (solc 0.8.24, evm `paris`) and `npx hardhat test`: 27 passing, including explicit non-replayable request IDs, pair-dust skimming, per-leg sell minimums, oracle-free in-kind exit with a blocked route, and supply/collateral invariants across both exit paths.
- Frontend: `registry:check` (66 assets), `typecheck` (zero errors), `test`: 93 passed, 10 skipped (opt-in live and V5 smoke suites).
- Backend: `bash backend/check.sh` (ruff lint + format, mypy, pytest): 30 passed, including history-range and Atlas subscription batching tests.
- Integration: `cd integration && npm test` (`run.mjs`): Hardhat fixture deploy, `sync-deployment.mjs 31337`, production market server on synthetic Atlas frames, Next.js (separate `NEXT_DIST_DIR`); then
  - browser E2E: create via UI (100 USDT seed + 10 USDT liquidity, random request ID), deposit 100 USDT (0.1 USDT creator fee), USDT exit of half the position with per-leg minimums (exact 10 bps fee and net), in-kind exit of the rest (exact per-token net and 10 bps creator fee), directory row;
  - V5 three-service Vitest smoke (`lib/integration-v5.test.ts`): launch, request-ID replay rejection, `isVault`, deposit, transfer, buy/sell, add/remove LP, USDT and in-kind redemption: passed.
- Live backend: Atlas push WS, 66/66 feeds priced (subscriptions batched at 20 channels; a single 66-channel SUBSCRIPTION is acknowledged but streams nothing).

Still not established: the public-chain launch authorization (signer) service and any chain-97 deployment.

## Originally executed (offline packaging environment)

- Frontend registry generator `--check`: 66 assets, current.
- TypeScript syntax/transpilation via globally installed TypeScript: 59 TS/TSX files, zero syntax diagnostics. Does not resolve dependencies or prove full types.
- Independent `pool-math.ts` strict TypeScript compile and direct Node assertions: 8,850 numeric cases plus 2 boundaries passed, covering decimal normalization and LP claims.
- Python 3.12 grammar parsing (system Python 3.13 with feature_version=3.12): 44 source/test files parsed. Not runtime tests.
- Existing independent integer accounting model: 20,000 cases passed. Not Solidity execution.
- Integration JavaScript syntax and shell syntax: passed.

## Blocked

- `uv sync --offline --all-packages --locked`: no Python 3.12 interpreter available in environment; runtime dependencies (returns, pyarrow) absent.
- `corepack pnpm install --offline --frozen-lockfile`: Corepack could not fetch pinned pnpm from npm registry.
- `npm ci --offline --no-audit --no-fund`: ENOTCACHED, required npm packages unavailable.
- Therefore full Python tests/lint/mypy, frontend Vitest/typecheck/build, Solidity compilation/runtime tests, and cross-service smoke were not run.

No chain deployment or browser E2E was performed. No public launch signer was configured. Actual chain-97 feeds/routes/preset/fees remain external release gates.
