# IndexFi — Contracts implementation plan V5

Date: 2026-11-26 | IndexFi / Jitter Labs | BNB Bangkok hackathon

**Target: passive A2 portfolio token with primary issuance/redemption and secondary PancakeSwap trading.** This revision supersedes V3/V4 planning where they conflict. It is a delta plan for the supplied repository, not a greenfield specification. No source changes or new runtime tests are claimed by this document.

## Shared product decisions (A–E confirmed)

| Area | Requirement |
|---|---|
| Product | Passive buy-and-hold portfolio, immutable constituents and initial weights; new deposits follow current value weights. No active management or rebalancing. |
| Funding | USDT only; minimum 100 USDT collateral funding plus independently specified initial LP quote funding of at least 1 USDT. USD=USDT assumption for MVP; exclude USDC. |
| Initial issuance | Initial NAV target 1 USDT/share; issue against actual acquired collateral value. Creator gets backed shares not allocated to LP. LP seed ratio matches NAV. |
| Supply | Transferable shares; elastic economic supply. Mint/burn preferred financially, but test unchanged OpenFour standard pre-minted inventory first; capped release/return acceptable if compatible. Count LP shares as outstanding. |
| Primary market | Permissionless USDT deposits and proportional USDT redemptions, minimum deposit 1 USDT; no explicit minimum redemption beyond executable amounts. Permanently close only when economic outstanding supply is zero. |
| Fees | Fixed 10 bps deposit and 10 bps redemption, paid automatically to creator in USDT. No configurable fee knobs, performance fee, cost basis, transfer tax, protocol fee (target; mandatory Core charges must be verified), or minimum creator ownership. |
| Secondary market | PancakeSwap V2, immediate graduation after funding where Core permits; creator receives unlocked LP tokens, anyone may add/remove their own liquidity. No managed liquidity or automatic replenishment. |
| Valuation | Atlas on-chain reference NAV, same verified prices for pre-deposit and contributed valuation; actual swap balance deltas, user slippage/deadline, atomic economic actions. Depositor/redeemer bears own execution costs. Redemption uses actual pro-rata holdings and does not require an oracle. |
| Backing | Collateral and migration quote/token reserves economically separated. No privileged collateral extraction. All released tokens, including LP shares, backed. Market price can differ from NAV; no guaranteed peg, liquidity or return. |
| Scope | BSC testnet 97; local 31337 tests. Chain 56 assets are reference only. No CMC, DB, indexer, active management, Python math package, or new server custody/signing by default. |

Section F is a **reuse-first implementation direction**, not verified end-to-end: standard OpenFourToken and StandardTokenModule first; minimally extend the token only if experiments require it. Reuse upstream Core, Registry, Deployer, Tools, FeeRouter and PancakeV2MigrateLib; custom basket Vault and preset validation; adapt Curve/Trade/Migrate only where needed. See contract gates below/companion contract plan. The mentor diagram's USDC, example 90/10 split, staged acquisition and locked LP manager are superseded by confirmed USDT, independent funding, atomic acquisition and creator-owned unlocked liquidity.

## Evidence baseline and execution discipline

Source inspected: `indexfi-source-2026-11-26.zip` (team ledger says uncommitted `feat/contract`), including `contracts/VALIDATION.md`, `contracts/RALPH_PROGRESS.md`, `backend/TEST_RESULTS.txt`, existing frontend sources and manifests. Upstream starter pinned at `079a45e9c3358c9f357c84f336c7d915c9f0e9fc`. Team reports 17 Solidity, 27 backend and 88 frontend tests passing; nine frontend opt-in live tests skipped in that validation run; browser create/deposit/redeem passes on local mocks; real OpenFour Core fork launch reported. Prior Phase II report: 16/16 live integration tests. These are historical reported results, not rerun in this revision. The archive lacks the `integration/` directory cited by its validation report. No chain-97 manifest or public-chain deployment proof. Mock adapter and 31337 addresses are fixtures. 66 Atlas WS reference feeds verified in prior run; chain-97 executable assets and on-chain oracle availability not established.

Use bounded Ralph iterations: select one task, inspect existing code, implement minimal delta, run relevant checks, fix failures, record files/commands/results/blockers in the workstream ledger. Mark done only on acceptance; distinguish fixture, local fork and public-chain evidence. Preserve working code and pinned dependencies; no unrelated rewrites. Never commit or expose credentials. Public-chain writes require operator approval and funding.

Companions: [Frontend](INDEXFI_FRONTEND.md) · [Server](INDEXFI_SERVER.md) · [Contracts](INDEXFI_CONTRACTS.md) · [Integration](INDEXFI_INTEGRATION.md) · [Product/demo](INDEXFI_DEMO_AND_PRODUCT.md).

## 1. Mission and actual source state

Own `contracts/openfour/` and its ABI/deployment artifacts; preserve Hardhat, solc 0.8.24, Paris, optimizer 200, viaIR, OZ 4.9.6 and the upstream starter lockfile. The current product is a different local investment vault; do not deploy it as the new financial model.

| Existing file (relative to contracts/openfour) | Current behavior | Required delta |
|---|---|---|
| `contracts/IndexFiFactory.sol` | 100 USDT seed, calls Core with maxSupply/saleAmount/raiseAmount=0, acquires collateral, records vault | Independent collateral/LP inputs, launch authorization bound to full args, backed allocation and migration; preserve atomic acquisition and correct creator binding |
| `contracts/token/IndexFiShare.sol` | Already inherits OpenFourToken; skips initial mint, vault issue/burn, `_transfer` reverts | Prefer upstream token unchanged; remove non-transferability/cost-basis model; fallback is minimal derived implementation, not new ERC20 |
| `contracts/modules/vault/IndexFiVault.sol` | Deposit priced before swaps using liquidation quotes; per-holder basis; 10% profit fee; migration hooks revert | Separate balances, Atlas valuation, actual acquisition deltas, tracked supply, fixed fees, permissioned reserve migration and post-migration primary operations |
| `contracts/modules/IndexFiOpenFourModules.sol` | Curve/Trade reject; migration disabled | Keep only policy required by tested lifecycle; reuse fixed-price launch/Trade modules where compatible; real migration |
| `contracts/validators/IndexFiPresetValidator.sol`, `presets/indexfi.json` | Prototype preset, unrestricted settlement address in config, zero maximum supply | Version new preset, constrain real quote, allowed assets, fee constants, fund/supply rules and module consistency |
| `contracts/interfaces/IIndexFi{,Adapter}.sol` | Old vault ABI, basis, deterministic preview interface | Revise ABI after capability gate; actual NAV, effective supply, reserves/pair, net previews, fees and events |
| `contracts/helpers/MockIndexFiAdapter.sol` | Deterministic fixed-price swaps | Retain for tests only; implement production PancakeSwap adapter separately |
| `scripts/deploy-indexfi.js`, `scripts/verify-indexfi-openfour.js` | Local deployment/fork launch; signature generation example | Extend existing scripts; versioned manifest and approved chain-97 deployment |
| `contracts/libraries/PancakeV2MigrateLib.sol` | Upstream pair creation/transfer/mint helper | Reuse, verify empty reserves and actual token balances before call; preserve migrated-pool registration/payload |

Current creation permits up to 32 constituents, a legacy implementation bound rather than a new product decision. Keep a documented tested gas/size limit until measurements justify changing it. Existing `contracts/VALIDATION.md` reports 45 npm advisories (12 high); review exposure before release, avoid indiscriminate breaking upgrades.

## 2. OpenFour compatibility first (Section F)

| Component | Default reuse policy | Evidence / remaining condition |
|---|---|---|
| Core, Registry, Deployer, Tools, FeeRouter | Use official deployed implementations | Developer-owned proxy deployment is documented; no Core rewrite |
| OpenFourToken | Unchanged standard token first | Pre-mints maxSupply into vault; no native post-init mint/burn. Transfers and migration phase built in. |
| StandardTokenModule | Reuse | Already used in current preset; compatible initialization must be proven with nonzero supply |
| Vault | Custom IndexFiVault implementing IOpenFourVault | StandardVault is single quote custody; insufficient for basket accounting |
| Curve and Trade | Reuse official FairLaunch/Simple where compatible | If immediate migration requires no trading, fail closed before ready; if Core requires presale use verified pricing and funding flow. Do not enable unbacked sales. |
| Migrate | Adapt official FairLaunchMigrateModule | Duration=0 permits eligibility in reference; stock reference sends LP to dead address, conflicts with creator-owned LP |
| PancakeV2MigrateLib | Reuse | Configurable lpRecipient; test empty pair reserves/balances, min liquidity, registration and reserve limits |
| Validator | Adapt existing | Require authorized settlement, assets and coherent preset params |
| CustomData | Omit | Unless actual Core requirement is proven |

Public source: [developer guide](https://github.com/four-meme-community/openfour-docs/blob/main/docs/developer-guide.md), [standard token](https://github.com/four-meme-community/openfour-docs/blob/main/contracts/token/OpenFourToken.sol), [starter](https://github.com/four-meme-community/openfour-docs/tree/main/developer/startup), [migration reference](https://github.com/four-meme-community/openfour-docs/blob/main/developer/startup/contracts/modules/migrate/FairLaunchMigrateModule.sol), [V2 library](https://github.com/four-meme-community/openfour-docs/blob/main/developer/startup/contracts/libraries/PancakeV2MigrateLib.sol), [fork deployment](https://github.com/four-meme-community/openfour-docs/blob/main/developer/fork-deploy/README.md). Pin the actually tested revision; compare to vendored source before using upstream features.

### Blocking experiments — do before rewriting the vault

| ID | Experiment | Acceptance / fallback |
|---|---|---|
| CT01 | Standard OpenFourToken inventory on real Core fork | Core creates token with finite cap; no unauthorized inventory release; direct vault release and return work, track outstanding claims separately; prove saleAmount/raiseAmount constraints. If unsuitable, minimally extend existing IndexFiShare for transferable vault-only mint/burn. |
| CT02 | Immediate migration and post-migration operations | Call actual Core migration API (starter script uses `core.migrate(token)`; verify ABI); no presale if possible. Show funded creator launch, deposits/redeems after migration and normal ERC20 transfers. |
| CT03 | Atomic coordinator and creator attribution | Test create → acquire → reserve → migrate in one transaction; exact caller/creator, signature and fees. If Core requires separate migration, document and obtain explicit approval before changing atomic launch requirement; no unbacked trading while pending. |
| CT04 | LP receipt and isolation | Reuse V2 helper, creator receives LP; creator removes liquidity; collateral unchanged and redemption still works. |
| CT05 | Atlas + PancakeSwap chain-97 proof | Verify feed addresses/interface/decimals/freshness or signed verifier, settlement token and both-way executable routes. Integration team supplies evidence. |
| CT06 | Core fee / registration / authorization | Verify required charges, signer and signed digest, registry rights, sponsor fork eligibility. Escalate any mandatory fees conflicting with zero protocol fee; do not bypass. |

These tests are outstanding; upstream support for individual extension points is not proof of the combined lifecycle. Prototype already used a derived token, so the fallback is small. The financial requirements remain unchanged if using inventory accounting.

## 3. Accounting and execution specification

All contract arithmetic uses integers, token decimals and explicit rounding (`Math.mulDiv`); no binary floats. Use a common USD/USDT valuation unit and convert settlement units exactly (test 6, 18 and supported constituent decimals). Let C_i = accounted backing token amount, p_i = verified reference price per whole token, V = sum(C_i × p_i / 10^decimals_i) in a consistent unit, S = outstanding backed shares, N = V/S. Reserve USDT, unissued own-token inventory and fees owed elsewhere are excluded. If USDT itself is a constituent, its collateral allocation must be separated from LP cash even within the same ERC20 balance. No double-counting. Fixed fees settle atomically; no hidden liabilities.

### Standard-token inventory branch (preferred experiment)

`totalSupply()` is constant pre-mint cap, NOT NAV supply. Track `outstandingShares` and authorized inventory separately. Only successful backed issue/release increments S, successful redemption/return decrements S. All LP shares count in S. Raw vault token balance alone is not the denominator: direct unsolicited transfers must not count as redemption or replenish releasable inventory. Define/test handling of accidental self-token transfers and inventory exhaustion (no sweep of backing); no arbitrary reissue after permanent closure. Explicit frontend getter and cap/available inventory. No claim that returned inventory is literally burned. If fallback mint/burn, actual ERC20 totalSupply is S and the vault is sole issuer/burner; test authorization and Core phase semantics. Cap selection is an experiment outcome, not chosen here.

### Creation

Creator chooses name, symbol, immutable constituent addresses/initial positive bps weights summing to 10000, collateral funding >=100 USDT, separate LP cash >=1 USDT. Approvals may be separate; economic acquisition is atomic. Read verified prices, purchase with per-leg min outs; count actual credited balances, not requested quantities or pre-swap quotes. Initial share unit target 1 USDT; S0=floor(actual collateral value / initial NAV) in share units. LP shares=floor(L/N_initial) using consistent base-unit scaling, creator gets S0-LP shares. Reject invalid or zero allocations, insufficient backing or pool ratio outside agreed rounding/slippage bounds. Example after frictionless 100+10 USDT: 100 outstanding shares, 90 creator, 10 LP, 10 USDT in pair. Initial creator seed is treated as funding (no primary deposit fee in this example); **confirm whether the 10 bps also applies at creation** before freezing ABI/preview. Later primary operations always charge the confirmed fee. Core native creation charges shown separately.

### Primary deposit

1. Require initialized/open vault and >=1 USDT, user deadline, minimum shares and per-leg min outputs. Read all verified oracle prices once; compute pre-deposit V, S and current value weights from pre-trade balances.
2. Charge floor(gross × 10/10000) USDT to creator, invest remainder using all allocations computed before any swap. Explicitly handle rounding remainder; no rebalance, no arbitrary new assets.
3. Measure actual collateral balance deltas, compute contributed value A with SAME oracle vector. Include only eligible collateral credited by transaction, never reserve balances. Issue floor(A*S/V) in normalized units; zero share issuance or insufficient inventory/min shares reverts. Test partial/zero legs and actual swap loss. Fee/issue/transfer all atomic.
4. Existing holders must not bear depositor swap costs. Any pricing inconsistency or unsupported transfer behavior reverts. Use checked decimals, no fee-on-transfer/rebasing token unless explicitly supported and tested; reject arbitrary routes. Oracle validity includes authentic source, valid positive price, supported feed, verified freshness/round as required by the on-chain adapter; permissive Python WS cache is not this oracle.

### Primary redemption

Use pre-redemption S and all accounted C_i. For r shares, remove floor(C_i*r/S) of each constituent (exact remainder for true last redemption), swap to USDT; count actual swap proceeds and eligible collateral USDT, exclude separate reserves. User specifies minimum net USDT, deadline; per-leg protection if adapter/ABI supports it, aggregate min net mandatory. Charge floor(gross proceeds × 10/10000) to creator, return net. Return shares to tracked inventory or burn (branch-specific); state updates and external calls protected against reentrancy. No per-holder cost basis or creator exemption specified; same primary schedule for everyone. No on-chain oracle read needed. No privilege can extract backing, even after creator exits. Entire operation reverts on any failure. If S truly becomes zero, close permanently and account for dust. V2 permanently locked MINIMUM_LIQUIDITY can leave outstanding shares held by the pair even after LP removal; do not pretend final zero is always reachable or let creator seize residual backing. Test and document residual share/closure behavior.

### Migration and secondary market

Migrate only after successful acquisition, oracle validation and correct backed allocation. Restrict migration functions to bound module and exact reserved token/USDT amounts, even if collateral includes USDT. Use official V2 factory/router verified per chain. A pair with zero LP totalSupply may still have pre-funded balances: reject or handle safely; do not silently seed at manipulated ratio. Register pair with token's existing hook, preserve Core phase transitions, emit canonical migration payload. Creator gets LP tokens; no lock/manager. Pair trades transfer existing shares without changing backing or outstanding S; no transfer tax. If liquidity removed, primary exit still works subject to underlying swaps. Core Trade/Curve integration must match tested actual path, not a decorative placeholder. A NAV curve, if needed for pre-graduation buy, must never create unbacked tokens or double-charge fees. Public post-migration issuance/redemption through vault if verified.

## 4. Delta implementation sequence

| ID | Task | State / prerequisites | Acceptance |
|---|---|---|---|
| CT00 | Reproduce uploaded baseline; pin source | Reported complete, rerun | Existing tests/compile and fork launch; document advisories and actual starting commit |
| CT01–06 | Feasibility experiments above | Pending, P0 | Evidence report selects supply branch and launch path; no hidden incompatible assumptions |
| CT07 | Update interfaces and preset schemas | CT01–06 | Exact ABI/event errors, cap/supply and fee semantics frozen for FE; version old ABI as fixture |
| CT08 | Production route registry + Pancake adapter | CT05 | Verified router/token/allowlisted exact-input routes, actual balance-delta tests, safe approvals, min-out/deadline |
| CT09 | Atlas valuation adapter | CT05 | Authenticated on-chain values, decimal and freshness vectors, unavailable deposit reverts; redemption independent |
| CT10 | Token and vault reserve/supply refactor | CT01,07–09 | Transferable token, accounting invariants incl. LP and USDT collateral; no old cost basis |
| CT11 | Factory launch and migration | CT02–04,10 | Atomic launch if proven, correct creator, NAV-priced LP and permission boundaries, no extra unbacked issue |
| CT12 | Primary deposit and redeem | CT10 | Current weights precomputed, actual contribution shares, fee rounding, min outs, zero/cap/closed behavior |
| CT13 | Core pricing/trading/fees and validator | CT06–12 | Reuse unchanged modules where applicable; verified pre-/post-migration behavior; exact fee accounting |
| CT14 | Adversarial and invariant tests | CT08–13 | Realistic non-linear swaps, both arbitrage directions, rollback, authorization, oracle attacks, rounding, LP exit, transfer/donation tests |
| CT15 | Chain-97 deployment and manifests | CT14 + verified assets/signer/funding | Authorized deployment, registry, receipts, public bytecode and matching ABI, real swaps |
| CT16 | Testnet E2E and FE handoff | CT15 | Create, discover, deposit, trade, redeem, LP removal; record evidence and limitations |

CT08/09 can develop against independently approved interfaces while other experiments run. No public writes before CT14 and operator approval. Existing `contracts/IMPLEMENTATION_PLAN.md`, `ARCHITECTURE.md`, `RALPH_PROGRESS.md`, `VALIDATION.md`, README must be updated in checkout as tasks progress.

## 5. Test matrix and remaining release gates

Unit: mixed decimals, fee boundaries/rounding, invalid basket and unsupported assets, same oracle vector, actual received quantities, allocation precomputation, max inventory, zero amounts. Integration: Core real fork creation/authentication, creator attribution and phase transitions, pair initialization, primary deposits and redemptions before/after migration as supported, two wallets, transfers, LP tokens, real route failures. Invariants: S conservation, every issued share backed, no reserve leak, no deposit dilution at fixed oracle prices beyond documented rounding, proportional redemption, fee settlement, no oracle needed to redeem, reentrancy and unauthorized migration fail, arbitrary token donation cannot manipulate accounting. Arbitrage: controlled test pair trades above/below NAV, perform mint/release + sell or buy + redeem only if net profitable after costs; assert directional convergence, not exact peg. Test quote slippage and sandwich-sensitive deposits; final redemption with no outstanding supply vs residual V2 locked shares.

Release blockers: actual standard token compatibility, cap, initial seed fee, mandatory Core fees, signed authorization, chain-97 Atlas data and real executable USDT routes, migration atomicity, pair/LP behavior, fork sponsor eligibility. If chain-97 oracle/pools unavailable, use explicit local fixtures and report blocker; no unsigned backend price as trusted on-chain valuation, no pretending deployment is complete.
