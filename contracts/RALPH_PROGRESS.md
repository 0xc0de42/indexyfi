# Ralph implementation ledger — V5

Baseline: supplied repo archive; old V1 reports archived under legacy-v1-fixtures/docs. All V5 tasks remain unaccepted until their checks pass. No public transaction, frontend/backend change or git commit.

| Iteration | Task | Outcome |
|---|---|---|
| 1 | CT00–06 | Reopened V5 spec and actual source, selected standard token inventory branch for experiment. npm/solc unavailable, real Core verification blocked; existing upstream source preserved byte-for-byte. |
| 2 | CT07–10 | Revised interfaces, standard token reuse, immutable oracle/route adapters and backing/reserve accounting implemented. Source-level only. |
| 3 | CT11–13 | Factory builds exact signed args; atomic seed/migration; upstream V2 library; creator LP; 10-bps fees; validator pins factory, new preset; no Core bonding trades. Source-level only. |
| 4 | CT14 | Added lifecycle and nonlinear V2 fixture tests, both arbitrage directions, cap, donations, oracle absence, LP withdrawal, and price normalization. Independent integer checks and JS syntax checks passed; Hardhat execution blocked. |
| 5 | CT15–16 | Local fixture deploy/ABI export, official local Core compatibility experiment and read-only chain-97 preflight scripts provided. No verified production addresses, deployment or FE handoff execution. |

## Acceptance gates remaining

1. `npm ci`, `npm run compile`, `npm test` with all fixtures; fix compiler/runtime issues, inspect bytecode size, gas and advisories.
2. Official Core registration, atomic create/migrate, post-migrate inventory operations, actual signer and creator binding; verify Core fee and lifecycle compatibility. If pre-mint model unacceptable, minimal OpenFourToken extension only, after evidence.
3. Real chain-97 oracle feeds, authorized reads, actual USDT and tradable constituents/route liquidity. Single-feed adapter only; multi-feed or signed pull support requires further implementation if those are the available feeds.
4. Confirm fee-free seed and deployment cap; evaluate stranded direct transfers and V2 locked minimum residual claims. Review security invariants and execution slippage before public deployment.
5. Public deployment authorization, real-chain smoke and E2E, generated ABI/manifest and FE integration. No task is marked production-complete.
