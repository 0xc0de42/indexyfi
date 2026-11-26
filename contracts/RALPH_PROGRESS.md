# Ralph loop ledger

All work is local on `feat/contract`; no commit was created.

| Loop | Context | Result |
|---|---|---|
| 1 | Contract implementation | Factory, vault, share token, preset, validator, deterministic adapter, deployment manifest and lifecycle tests implemented. |
| 2 | Frontend integration | Factory directory, vault reads, Atlas display-price join, create/deposit/redeem approvals, simulations, receipts and wallet positions implemented. |
| 3 | Backend/system fixture | Production backend composition is exercised with deterministic Atlas websocket data; no transaction signer was added to the backend. |
| 4 | Browser integration | Two wallets complete create → discover → deposit → redeem against the running chain, backend and frontend. |
| 5 | Upstream compatibility | IndexFi preset registers and a funded vault launches through a real OpenFour Core on a developer-owned fork. |
| 6 | Regression | Contracts 17 passing; backend 27 passing plus static checks; frontend 88 passing plus typecheck/build; browser E2E passing. |

## Deliberate boundaries

- Graduation to PancakeSwap is optional and the migrate module currently fails
  closed. Share transfers remain disabled until transferable-basis and LP
  economics are designed.
- The 10% creator fee uses independent average-cost profit per redemption. There
  is no realized-loss carryforward in this version.
- Local manifests and the mock adapter are test fixtures. A testnet release must
  supply verified assets, routes and a production adapter.
- OpenFour Core validates a per-launch signature from its configured signer.
  Public testnet creation therefore needs an authorized signature service; the
  frontend sends no secret and the backend intentionally owns no signing key.
