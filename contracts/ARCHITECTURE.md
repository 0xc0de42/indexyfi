# V5 contract architecture

`IndexFiFactory` is a thin atomic coordinator. It builds signed Core create arguments (creator, full basket, funding amounts, minimums hash, deadline, native fee, request ID), invokes official `Core.createToken`, obtains its bound vault, collects collateral + quote reserve, seeds it, invokes `Core.migrate`, and records the vault only after migration. Core's recorded creator may be the factory; `IndexFiVault.creator()` records the economic creator explicitly. Test signer and creator attribution on the actual fork. No separate ERC20 implementation is introduced.

| Component | Responsibility |
|---|---|
| OpenFourToken, StandardTokenModule | Existing upstream pre-mint, transfers, phase and pair hooks |
| Core, Registry, Deployer, FeeRouter | Existing official deployed infrastructure, no replacements outside fixtures |
| IndexFiVault | Accounted holdings, inventory/claims, fixed primary fees, NAV, reserve migration |
| IndexFiCurveModule, IndexFiTradeModule | Fail-closed pre-graduation policy; no unbacked Core trading |
| IndexFiMigrateModule | Eligibility after funding, empty pair validation, creator LP; upstream PancakeV2MigrateLib |
| IndexFiPresetValidator | Pins preset to factory, quote, oracle, routes, cap and portfolio constraints |
| AtlasPushOracle | Immutable asset-to-single-feed mapping; normalized prices, authenticated contract read, age/round validation |
| PancakeV2BasketAdapter | Immutable exact-input route allowlist, minimums/deadlines, balance delta checks |

Accounting invariants: inventory + outstanding = ERC20 cap; reserved LP shares are already outstanding; vault holds at least inventory + untransferred LP reserves; accounted constituent balances exclude unsolicited donations and migration USDT; no swap or primary transaction is permitted to withdraw reserve balances. Redemption is based on pre-redemption accounted holdings and outstanding shares. Fees floor at the settlement token's precision. Allocation rounding remainder goes to last positive value-weighted asset. Quotes are indicative because routes may share pools; actual output/issuance checks govern execution. Initial V and S use USD18 value of actual received collateral, so NAV = 1e18, LP shares = quote reserve normalized to 18 decimals. No privileged collateral withdrawal, no arbitrary strategy management.

This is a source-level implementation candidate; actual Core permissions, phase changes, sale metadata compatibility, callback ordering, fee handling and contract size/gas are unresolved until compiled and fork-tested.
