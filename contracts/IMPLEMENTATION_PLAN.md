# IndexFi public basket vaults — implementation plan V5

This revision supersedes V3 for contract work, including the earlier USDC architecture draft and the Phase III fixed-supply roadmap. The two local phases are implemented on `feat/contract`: contracts and application integration. The pinned OpenFour starter retains its 13 baseline tests, with four IndexFi lifecycle tests and a browser-driven system test added. An authorized BSC Testnet (97) deployment remains an operator step.

## Product decisions

- A creator funds at least 100 USDT once. A successful atomic basket purchase opens the vault for public deposits. The seed earns all initial shares. There is no ongoing ownership floor. The creator can fully exit while others remain and remains the designated fee recipient.
- Each deposit buys actual constituents and mints backed shares. Each redemption burns shares and sells proportional holdings for USDT. Shares track individual accounts and cannot be transferred in the MVP. This design choice keeps the depositor’s acquisition cost attributable.
- Charge 1,000 basis points on each depositor’s positive realized gain at redemption. The creator earns the return on their own shares and the fees on other holders’ gains. No entry, management or IndexFi creation fee. Show network, DEX and any mandatory OpenFour charges separately.
- The first demo covers create, deposit, redeem, and creator fee settlement. PancakeSwap trading of the share token is a stretch milestone. Constituent swaps may already use PancakeSwap. Separate market-maker capital, LP ownership, transferable share accounting and sponsor compatibility require a design before enabling share trading.
- The reference is [Lighter public pools](https://docs.lighter.xyz/trading/public-pools). The one-time 100 USDT seed, 10% rate and freely redeemable creator stake are IndexFi decisions.

## Wallet calls and files

Exact proposed Solidity declarations, tuple field order, return values and events live in `contracts/openfour/contracts/interfaces/IIndexFi.sol`. Amounts are unsigned integers in the token’s smallest unit. Use 18 decimals for shares, basis points for weights, Unix seconds for deadlines, and bigint in the wallet adapter.

| UI flow | Wallet or read call | Contract responsibility |
|---|---|---|
| Create | Approve seed USDT to factory, then `createVault(basket, seedUSDT, minTokenOut[], deadline, launchAuthorization)` | Validate inputs, create through OpenFour, acquire constituents, issue seed shares and emit VaultCreated only on success. Native value covers the verified upstream creation fee if applicable. |
| Explore | `vaultCount()`, `vaultAt(index)`, VaultCreated events | Discover activated vaults from the factory. Read long-form display metadata from the URI bound at creation. |
| Deposit | Approve USDT to vault, then `deposit(usdtIn, minSharesOut, minTokenOut[], deadline)` | Acquire assets and credit shares and basis to the caller. Minimum outputs follow immutable constituent order. |
| Position | `balanceOf(holder)`, `totalSupply()`, `costBasisUSDT(holder)`, `constituents()`, `creator()`, `closed()` | Display ownership, remaining basis and vault state. Simulate writes with the caller address and quote current routes before requesting a signature. Simulations are indicative. |
| Redeem | `redeem(shares, minNetUSDT, deadline)` | Burn caller shares, liquidate their basket fraction and enforce the user’s minimum after creator fees. Redeemed records the actual split. |

## Accounting rules for implementation

1. Validate unique chain-97 tokens and weights totaling 10,000 bps. Bind each token to its verified decimals, executable buy and sell routes, and valuation feed. Support a USDT basket leg as cash. Reject unsupported transfer behavior. The backend snapshot and chain-56 catalog serve display only.
2. On creation, scale seed USDT to 18 decimals for initial share count. Reject any acquisition leg that fails its minimum. On subsequent deposits, use pre-deposit actual holding proportions, valued at one validated on-chain price vector. Issue floor(net acquired value × old supply / pre-deposit basket value), valuing measured balance deltas at the same prices. Check minSharesOut and reject zero-share deposits. Track basis using the actual USDT contributed. Validate timestamps, feed identities and units before financial use.
3. For r shares out of holder balance h, release floor(holder basis × r / h) from that holder’s basis. A full exit releases all remaining basis. Sell floor(holding × r / total supply) of each constituent, aggregating actual USDT proceeds including any cash leg. Creator fee = floor(max(gross proceeds − released basis, 0) × 1000 / 10000). Pay the creator and send the remainder to the holder atomically. For creator redemptions the creator receives all proceeds with zero fee charged to self. This proposed average-cost convention charges per profitable redemption, with no separate realized-loss carryforward.
4. Final redemption takes all residual basket balances and closes permanently. Reject zero-net redemptions, expired calls and reentrancy. A failed required swap, fee payment or output minimum reverts the complete operation. A creator exit alone never closes a vault with outstanding shares.

## Phase 1 — Implement and verify the contracts

Paths in this phase are relative to `contracts/openfour/`. The existing interface is the starting ABI. Publish the final ABI and example receipts as the handoff to both application teams.

| Order | Implementation files | Deliverable and acceptance |
|---|---|---|
| 1 | `contracts/IndexFiFactory.sol`, `contracts/validators/IndexFiPresetValidator.sol`, `test/IndexFi.lifecycle.test.js` | Implemented. Official OpenFour fork registration and factory-funded creation are reproducible with `scripts/verify-indexfi-openfour.js`. The Core signer owns launch authorization; delivery for an authorized public deployment is still an operator boundary. |
| 2 | `contracts/helpers/MockIndexFiAdapter.sol`, `presets/indexfi.json` | Local deterministic adapter implemented for accounting and system verification. A production Pancake adapter and verified chain-97 asset/routes manifest remain deployment work. |
| 3 | `contracts/modules/vault/IndexFiVault.sol`, `contracts/token/IndexFiShare.sol`, `test/IndexFi.lifecycle.test.js` | Implemented for threshold launch, multiple holders, creator exit, profitable redemption fee, output protection and rollback. |
| 4 | `contracts/interfaces/IIndexFi.sol`, `scripts/deploy-indexfi.js`, `deployments/*.json` | Implemented. Deployment emits the manifest and ABIs consumed and validated by the frontend. |

**Phase 1 exit.** Deliver compiled ABIs, a local deployment manifest (chain ID, factory, deployment block, settlement token and decimals, route/quoter addresses), and a versioned mapping from execution-chain constituent address to backend reference asset ID and Atlas feed ID. Include decoded create/deposit/redeem receipts and expected balances from a two-wallet run. Testnet deployment uses its own verified manifest and operator authorization. The 13 starter tests establish the upstream baseline; the IndexFi lifecycle requires its own test run.

## Phase 2 — Integrate frontend, backend and contracts together

Use the existing frontend Wagmi provider for chain reads and wallet signing. Keep the Python service responsible for Atlas market data and minute history. A single vault detail screen combines both sources. Read current holdings and supply at the same block, then join backend prices using the Phase 1 mapping. Label any resulting NAV as indicative and show the price timestamp. Execution quotes come from the on-chain route and valuation path.

| User action | Frontend reads | Writes and confirmation |
|---|---|---|
| Browse vaults and view details | Factory count/addresses, creator, metadata, closed state, supply and constituent balances via RPC. Reference prices from backend `GET /snapshot`; constituent charts from `GET /history` with mapped `asset_id` and time range. | Public reads work with a disconnected wallet. Backend collector writes minute closes to Parquet. Historical portfolio NAV requires historical holdings and supply as well as prices; show constituent history for the MVP. |
| Create | Factory seed minimum and settlement address, verified basket routes, USDT decimals/balance/allowance, native creation fee and launch authorization. | Wallet approves factory if needed, waits for confirmation, simulates and submits `createVault`. Decode `VaultCreated` for the actual address, then refresh discovery and open the detail page. |
| Deposit | Vault state, ordered constituents, settlement balance/allowance and executable acquisition quote. Display expected shares and user-selected minimums. | Wallet approves the vault if needed, waits for confirmation, simulates and submits `deposit`. Decode `Deposited`, then refresh holdings, supply, wallet balance and basis. |
| Redeem and view investments | Vault share balance, holder basis, current route quote and expected gross proceeds, creator fee and net USDT. Load wallet activity from scoped contract events starting at the manifest deployment block. | Wallet simulates and submits `redeem` with the net minimum. Decode `Redeemed`, refresh account and vault reads, and reflect final closure. Record actual proceeds and fee from the confirmed receipt. |

**Integration files and order**

1. In `frontend/apps/web/components/providers.tsx` configure the selected local or testnet chain. Add `frontend/apps/web/lib/vaults.ts` for manifest validation, reads, simulations, approvals and receipt decoding. Use bigint for wallet amounts and decimal strings for market prices. Reject a manifest/network mismatch before signing.
2. In `frontend/apps/web/lib/catalog.ts`, bind chain addresses to backend IDs using the shared manifest. Reuse `lib/api.ts`, `lib/prices.tsx` and `lib/history.ts` for the existing market endpoints. Validate the joins against `backend/services/server/src/ind_server/api.py` and `serialization.py` with a shared fixture. The current feature set requires no backend transaction endpoint, signer or chain indexer.
3. Wire `components/explore.tsx`, `portfolio.tsx`, `create.tsx` and `investments.tsx` to these adapters. Invalidate account-specific reads on wallet/network change. Handle rejected signatures, reverts and pending receipts. A missing feed or backend initialization 503 makes the affected price display unavailable; on-chain positions remain readable.
4. Run the real frontend, aiohttp backend and a locally deployed contract set together. Feed deterministic Atlas observations into the backend and exercise two browser wallets through create → discover → deposit → redeem. Check snapshot/history joins, gross/fee/net figures, token balances, receipt-driven refresh and state after a page reload. Repeat with wallet rejection, failed slippage minimum and backend unavailability. Record the authorized chain-97 smoke run separately using verified assets and receipts.

**Phase 2 exit — passed locally.** From the running UI, a creator launches a funded vault, a second holder discovers and funds it, and a profitable redemption pays the documented fee. The browser run reconciles 120 USDT gross, 2 USDT creator fee and 118 USDT net while the backend serves all 66 configured prices. Graduation remains optional after this flow.
