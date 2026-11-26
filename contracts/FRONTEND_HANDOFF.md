# V5 ABI handoff (source contract; not compiled ABI)

Generate ABI from successful Hardhat compilation, not legacy V1 fixture files. Existing frontend remains unchanged in this delivery. Do not deploy V5 into the V1 UI without the following adaptation.

| Read / operation | Semantics |
|---|---|
| `factory.minimumSeed()` / `minimumLiquidity()` | USDT base units; >=100 / >=1 respectively |
| `factory.previewCreate(basket, seedUSDT)` | Indicative per-leg token outputs, no LP funding included |
| `factory.buildCreateArgs(creator,basket,seedUSDT,liquidityUSDT,minCreatorShares,minimums,deadline,createFee)` | Exact bytes to authorize using Core signer workflow; tied to current request ID. Rebuild after other creation if needed. |
| `factory.createVault(basket,seedUSDT,liquidityUSDT,minCreatorShares,minimums,deadline,authorization)` | Approve seed + liquidity USDT to factory; native value = authorized createFee; simulate first; returns vault and creator's shares (not total issued). |
| `factory.vaultCount()/vaultAt(i)` / `VaultCreated` / `PortfolioLaunched` | Discovery and actual pair + supply |
| `vault.token()` | Standard ERC20 address, transferable |
| `vault.outstandingSupply()` / `vault.totalSupply()` | Backed 18-decimal shares including LP holdings, NOT ERC20 cap |
| `vault.inventory()` | Unissued inventory |
| `vault.collateralBalance(asset)` | Accounted token base units; use instead of raw wallet balance for NAV |
| `vault.collateralValue()` / `vault.nav()` | 18-decimal USD (USDT parity); unavailable when oracle invalid; NAV reverts at zero supply |
| `vault.pair()` / `vault.creator()` / `vault.phase()` | Secondary market, economic creator, OpenFour lifecycle; 3 = Migrated |
| `vault.previewDeposit(grossUSDT)` | shares and leg outputs; fee 10 bps; actual execution may differ |
| `vault.deposit(gross,minShares,minTokenOut[],deadline)` | approve USDT to vault; returns released shares |
| `vault.previewRedeem(holder,shares)` | gross, fee, net in USDT base units; no oracle dependency |
| `vault.redeem(shares,minNetUSDT,deadline)` | approve ERC20 portfolio token to vault; returns net, fee; inventory return (not burn) |
| `Deposited` / `Redeemed` | revised events; no basis or profit fields |
| PancakeSwap pair/router | Use verified official deployment interfaces; secondary buy/sell and LP add/remove are independent of vault; quote executable route, approvals, min out and deadline |

Creation fee is not the primary transaction fee. Remove all cost basis and 10% profit UI. Fixed 0.1% primary fees; initial seed fee-free as provisional decision. Distinguish market price, NAV, premium/discount, backing and LP liquidity. No frontend Atlas key/signing key. No new backend functionality. V5 local manifest schemaVersion=5, fixture=true, supplyModel=standard-openfour-inventory; generated only after compilation and local deployment. No chain-97 manifest is available yet.
