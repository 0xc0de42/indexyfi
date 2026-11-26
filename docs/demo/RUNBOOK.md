# IndexFi pitch demo — runbook (BSC Testnet, chain 97)

App: http://localhost:3000 (frontend `corepack pnpm --filter @indexfi/web dev`, backend `.venv/bin/python -m ind_server --config config.toml` on :8000).
All amounts are testnet units. Contract addresses: `docs/submission/CONTRACTS.md`.

## Accounts (one browser profile each)
| Wallet | Address | Role | Funded to (by `scripts/demo-fund.cjs`) |
|---|---|---|---|
| A | `0xB64c94312De7Ff21FBb7f323Bfc3d9f1A6A3f1cE` | Operator, OpenFour creator (OpenFour Core signer) | 15,000 test USDT · 2,000 Flap USD · ~20 tBNB |
| B | `0xe716a4894a5558140c3E3FdE2772AE71A69aAB9e` | Investor | 25,000 test USDT · 5,000 Flap USD · 0.5 tBNB |
| C | `0x0cdf9fa9934aC2F8615d2ccD2b65A9968a275C1b` | Secondary trader, Flap creator | 2,000 test USDT · 5,000 Flap USD · 0.5 tBNB |

Gas: a launch costs ~0.0008 tBNB at 0.1 gwei; every other action ≤ 0.0002 tBNB.

## Prepared portfolios (backups, already on chain)
| Portfolio | Venue | Vault | State |
|---|---|---|---|
| Crypto Blue Chip (CBI) — BTCB 50 / ETH 30 / slisBNB 20 | OpenFour | see `dump/preset-ready/deployments/97.json` → `baskets.CBI` | launched by A, graduated by B's deposit, C holds shares |
| Top 3 Market Cap (T3MC) — ETH 35 / XRP 35 / SOL 30 (CMC caps, 35% cap) | Flap | `0x6991D544d3Cb4AAa2aBBd211eD8fe2D174bB96FA` (token `0x629D…7777`) | launched by C, B holds ~199 shares |

Both symbols carry demo rebalancing presets (CBI: daily / 5%; T3MC: daily / 5%, top 3 crypto by market cap), so the
Rebalancing card shows in every browser profile.

## Flow I — Crypto Blue Chip on OpenFour (2–3 min)
1. **A** · Create → name "Crypto Blue Chip", ticker e.g. CBI2 → Composition: BTCB, ETH, slisBNB → Allocation 50/30/20
   → Review: venue **OpenFour**, rebalancing daily / 5% → **Launch portfolio** (approve, sign the OpenFour authorization,
   confirm). Uses 1,100 test USDT.
2. Portfolio page: Actual collateral (acquired assets), NAV from Atlas prices, Rebalancing card (demo).
3. **B** · Explore → the new portfolio → Deposit 200 → My investments shows the shares → Redeem ~50.
4. **B** · Deposit 9,300 → badge turns "Graduated · PancakeSwap", Buy/Sell appear (display unlock; the pool exists since launch).
5. **C** · Buy 5–10 USDT on PancakeSwap → Sell or redeem.
If anything stalls: switch to the prepared **CBI** (already graduated; C already holds shares).

## Flow II — Top 3 Market Cap index on Flap (2–3 min)
1. **C** · Create → name "Top 3 Market Cap", ticker e.g. T3MC2 → Composition: **Index: top N by market cap** →
   Universe **Crypto**, **Top 3**, Market cap, max **35%** → Apply (ETH / XRP / SOL from live CMC data).
2. Review: venue **Flap (tax token)** (any wallet; …7777 address mined automatically), rebalancing **daily / 5%** → Launch
   (approve + confirm). Uses 1,100 Flap USD.
3. **B** · Deposit 200 Flap USD → shares.
4. **C** · Portfolio page → Rebalancing card: current vs target weights, proposed trades, schedule, index re-selection
   (demo, not executed on chain — say so).
5. **B** · Redeem ~50.
If anything stalls: use the prepared **T3MC**.

## Preparation (re-run the day before and ~1 h before the pitch)
From `contracts/openfour` unless noted. Every script is idempotent; plan first by omitting the APPLY flags.
1. Balances: `DEMO_APPLY=1 CONFIRM_CHAIN97=1 node scripts/demo-fund.cjs`
2. Flap pools to Atlas: `FLAP_APPLY=1 CONFIRM_CHAIN97=1 node scripts/flap-realign-pools.cjs`
3. OpenFour pools to Atlas (from `dump/preset-ready`): `REALIGN_APPLY=1 CONFIRM_CHAIN97=1 npx hardhat run scripts/realign-pools.cjs --network bsctestnet` (~25 min)
4. Check deposit quotes (from `dump/preset-ready`): `npx hardhat run scripts/check-deposits.cjs --network bsctestnet`
5. Open the app in the three profiles; confirm "Price API responding" and "CMC market data 66 / 66".

Why realign: large deposits move the constituent pools; the Flap vault rejects issuance when a pool is >5% from Atlas,
and OpenFour deposits lose value to the gap. The flow pools (BTCB, ETH, slisBNB on OpenFour; ETH, XRP, SOL on Flap) are
1M USD deep, so a 9,300 deposit moves them ~0.5%.
