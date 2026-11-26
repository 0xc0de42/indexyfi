# Flap V3 — chain-97 fork acceptance (2026-11-26)

`contracts/openfour/scripts/flap-fork-launch.cjs` on a local Hardhat fork of BSC testnet
(`hardhat.flapfork.config.js`, block ≈ 145,018,955). Real Portal, Token Dock, Guardian, whitelist helper and Flap
USD; mock adapter/oracle and a mock constituent (oracle/adapter are not under test here). Nothing was broadcast.

| Release gate (FRONTEND/BACKEND plans) | Result |
|---|---|
| Portal supports `lf-v1` / `pl-v1` / `newLauncher` / `launchTaxTokenV2` / native vault callback | **Pass**: 2-asset launch created vault, `…7777` token and PancakeSwap pair; `isVault`, phase 3; gas ≈ 7.12M |
| Factory enablement | **Self-service**: `0x7777…7777.whitelist(factory, 0)` is callable by anyone; multiplier `(false,10000)` → `(true,0)` |
| Salt rule | **Token address must end in `7777`.** `token = CREATE2(Portal, salt, keccak256(EIP-1167 clone of 0x7777c57ff7dc441c1715b2e36fa581c48b782222))`; random salt reverts `0xca4c5b2d(address)`; ≈ 65k tries expected (19k–143k observed) |
| Salt locking / native fee | **Not required** (launch succeeded with `msg.value = 0`, no lock) |
| DEX for `dexId = 0` | **PancakeSwap V2 testnet** (router `0xD99D…50D1`; the vault's `getPair` check passed) |
| Flap USD `0x190C…0157` | **Public `mint(address,uint256)`**: anyone can mint for seeds and pools |
| Deposit / redeem / redeem-in-kind via real Token Dock | **Pass**: 100 USD → 99.9 shares (10 bps fee); inventory restored exactly after redemptions |
| Secondary trade on the Portal's pair | **Pass**; with `taxDuration = 1` the 1% sell tax had already expired (0% charged) |
| Anti-scam name/symbol | Our name/symbol passed; the actual rules are still unknown |

Formula verified independently against a real launch (tx `0x5e3c…8476`, token `0xba80…7777`).

Still open: genuine signed oracle + adapter bound to Flap USD (our `AtlasSignedOracle` code, new instance), 66
asset/Flap-USD pools, tax-duration choice (1 s ≈ no tax), and the anti-scam rules.
