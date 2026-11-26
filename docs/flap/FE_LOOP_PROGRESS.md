# Flap frontend completion loop

Each pass: take the first open task, implement, test (typecheck, unit tests, browser where it applies), commit,
update this file. Stop when every task is done.

| # | Task | Status | Notes |
|---|---|---|---|
| 2 | Demo rebalancing preset for the Flap demo portfolio (IFDEMO) | done | IFDEMO preset (1 h / 0.1%) |
| 3 | After-tax amounts in the Buy/Sell panel (tax active only within taxDuration of launch) | done | tax applied within taxDuration of launch; "Trading tax" row |
| 4 | ABI parity test: frontend ABIs vs contracts/openfour/flap-abi | done | lib/flap-abi.test.ts (selectors and outputs) |
| 6 | Venue filter on Explore (All / OpenFour / Flap) | done | All / OpenFour / Flap |
| O1 | Scheduled next rebalance for demo settings (from the vault's launch time) | done | "Next scheduled check" from the launch block |
| O2 | Simulated rebalance history from stored Atlas prices | done | 24 h replay of stored Atlas prices at schedule boundaries |
| 1 | Flap lifecycle through the UI with a wallet on chain 97 | open | launch, deposit, buy, sell, both redemptions, forward |
| 5 | Soft graduation for Flap | decided | Keep the OpenFour rule (Buy/Sell after 10k AUM) for consistency; no user answer, default taken |
| 7 | Merge feat/flop into main and push | open | last |
