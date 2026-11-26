# IndexFi Flap Backend MVP Integration Plan

Status: proposed implementation plan  
Target: BNB Chain testnet, chain ID 97  
Provider: Flap direct launch V3

## 1. Objective

Land the backend, deployment and integration-runner support required for IndexFi to launch through
either Flap or OpenFour, using assets executable through both PancakeSwap and Atlas on chain 97.

The MVP is successful when:

1. The IndexFi Flap contracts are deployed and the factory is enabled by the Flap Portal.
2. The provider catalogue exposes separate, validated Flap and OpenFour manifests.
3. The server prepares a Flap request ID, vanity salt, predicted token address and launch
   authorization.
4. The integration runner launches a Flap portfolio with Atlas-signed prices.
5. The resulting vault, token and pair are discoverable through contract reads and events.
6. Test wallets complete deposit, redemption, buy, sell and tax-forwarding actions.

## 2. MVP scope

Included:

- Flap V3 factory, launcher, vault factory and vault.
- Chain-97 deployment using official Flap Portal, Dock Router, Guardian and Flap USD.
- A generated Flap execution mapping containing the intersection of assets supported by the
  PancakeSwap adapter and Atlas oracle.
- Existing Atlas signed-price delivery.
- Server-side Flap salt preparation.
- Provider-aware deployment catalogue and BFF contract.
- Tax display and permissionless tax forwarding.
- One local/fork test and one real chain-97 demo launch.

Excluded from this release:

- Rebalancing and index-rule execution.
- A backend event indexer or database.
- Persistent launch intents.
- Automated gap recovery or transaction relaying.
- Mainnet deployment.
- Contract upgrades or further contract-size work.
- A security-hardening project beyond checks required to make the demo reliable.
- Treating a market-data-only asset as executable when it lacks a verified PancakeSwap route.
- Browser UI implementation and presentation decisions.

The implementation will generate and admit every selected asset that passes the same
PancakeSwap-plus-Atlas checks. The intended execution universe is the full current 66-asset set.
The contract permits at most 32 constituents in one basket, so verification covers the full
universe through route probes and multiple baskets rather than attempting one 66-asset vault.

## 2.1 Locked product decisions

- Flap does not replace OpenFour. Backend artifacts expose both launch providers so the eventual
  caller can select one explicitly.
- Both provider directories remain readable in the platform.
- Flap uses the existing launch amounts unless a protocol constraint is discovered:
  - 1,000 settlement tokens invested as collateral.
  - 100 settlement tokens supplied as initial pool liquidity.
  - $1 starting NAV.
  - One-billion-token maximum supply, matching the existing chain-97 OpenFour deployment script
    and validated Flap fixture.
- Flap asset admission is generated from actual execution support, not maintained as a separate
  manual ticker list.
- Reuse the existing 66 chain-97 constituent token contracts. Create separate Flap-USD pools and
  Flap-specific adapter/oracle bindings rather than deploying another token set.
- Configure the closest achievable OpenFour tax behavior: 0 bps buy tax and 100 bps sell tax.
- Keep that tax active for one day on the demo deployment. A one-second duration expires before a
  realistic buy/sell cycle and cannot demonstrate `forwardTaxRevenue`.
- Mine the required `7777` salt automatically off-chain and pass it through the shared
  `launchAuthorization` field. Do not lock the salt, charge a lock fee or ask the user for a salt.
  On a collision, discard the preparation and mine a new salt.
- The existing Atlas signed-oracle implementation is reused, but a new instance is deployed with
  Flap USD and the Flap execution-token bindings because the OpenFour instance has immutable
  settlement and asset bindings.
- Deployment and pool funding use the operator credentials already stored in the ignored root
  `.env`. The deployment preflight requires approximately 20 tBNB and never prints or copies the
  private key.
- MVP acceptance is the complete lifecycle: creation, deposit, buy, sell, cash redemption, in-kind
  redemption and tax forwarding.

The amounts are compatible with the current Flap factory minimums: 100 settlement tokens of seed
and one settlement token of liquidity. The Flap path uses Flap USD rather than the OpenFour test
USDT address.

One unavoidable economic difference also remains: OpenFour portfolio tokens have no secondary
transfer tax, while the current Flap factory requires at least one of buy or sell tax to be at
least 100 bps. The closest configuration is 0 bps buy and 100 bps sell. The existing IndexFi 10 bps
creator fee on deposits and redemptions remains unchanged and separate.

## 3. Existing implementation baseline

The repository already contains:

- `IndexFiFlapFactory`, `IndexFiFlapLauncher`, `IndexFiFlapVaultFactory` and
  `IndexFiFlapVault`.
- Generated Flap ABIs.
- A dedicated Flap Hardhat build and `test-flap/` suite.
- 18 passing local Flap tests and 31 passing OpenFour tests.
- An existing Atlas signed-price BFF route at `GET /api/atlas/signed`.
- Existing OpenFour contract client and integration scripts that can be extended for Flap.
- Existing chain-97 reference assets and CMC/Atlas market-data integration.

Testnet factory authorization:

- An unregistered factory returns `(false, 10000)` from `launcherFactoryMultiplier` and cannot
  launch.
- On BSC Testnet, the operator should configure the deployed Launcher Factory directly through the
  helper at `0x77779969a11eff7582f3bCf48135A846A3457777` by calling
  `whitelist(launcherFactory, 0)`.
- Flap approval is not expected for the testnet zero multiplier. Mainnet reduced multipliers remain
  subject to Flap review and audit.
- If self-whitelisting fails, capture the simulation/revert and escalate that specific failure to
  `@bytes16` and the Flap technical mentor in the existing hackathon support channel.

Confirmed from Flap's taxed-token launch guidance:

- Tax Token V3 addresses must end in `7777`.
- CREATE2 prediction uses the Portal as deployer and the taxed-token implementation's EIP-1167
  minimal-proxy bytecode.

Still to confirm on chain 97:

- The taxed-token implementation address.
- That the imported `launchTaxTokenV2` path accepts the selected unlocked salt exactly as Flap's
  Launcher guidance specifies.

## 4. MVP architecture

```text
Wallet client or integration runner
  -> Next.js BFF: signed Atlas prices and Flap launch preparation
  -> IndexFiFlapFactory
  -> Flap Portal and Dock
  -> IndexFiFlapVault

Python backend
  -> existing Atlas snapshots, history and CMC APIs
  -> no Flap-specific changes for the MVP
```

The wallet remains the transaction sender. The BFF returns unsigned preparation data and never
holds a creator key or broadcasts financial transactions. The operator credential is used only by
deployment and pool-funding scripts, not by public BFF routes.

## 5. Phase A — Confirm the minimum Flap launch interface

Run a representative launch against a local fork of chain 97, then exercise every generated asset
route. No individual basket may exceed the factory's 32-constituent limit.

On the fork:

1. Pin a chain-97 block containing the current Portal and Dock implementations.
2. Deploy the IndexFi Flap implementation contracts.
3. Enable the new factory in fork state.
4. Mint Flap USD to the deployer and creator.
5. Create and fund the constituent/Flap-USD pools for the generated execution universe.
6. Register the launcher and execute one complete launch.
7. Record the token address, salt, launcher, vault, pair and emitted events.
8. Confirm the CREATE2 prediction formula using the Portal as deployer and the chain-97 taxed-token
   implementation's EIP-1167 clone bytecode.
9. Confirm the taxed-token `7777` suffix against chain 97.
10. Confirm whether a separate salt-lock transaction is required for this direct-launch path.

Acceptance:

- The predicted token equals the token emitted by the real forked Portal.
- The Portal records the IndexFi launcher and vault.
- The Dock contains the expected distribution.
- Initial LP is burned as designed.
- A failed launch rolls back atomically.
- Every generated asset passes a buy and sell route probe.
- Baskets covering the generated universe in groups of at most 32 pass quote validation.

If the fork proves that the current nested factory/launcher caller identity is incompatible with
the Portal, stop and fix that contract interaction before implementing the live integration run.

## 6. Phase B — Generate the executable mapping and deploy the chain-97 stack

Add a generated Python mapping alongside the existing Atlas selection:

```text
backend/packages/assets/src/ind_assets/flap_selected.py
```

It must be generated rather than edited by hand and expose a typed immutable tuple, following the
style of `ind_assets.selected.SELECTED_ASSETS`. Each row records:

```python
FlapAsset(
    reference_asset_id=AssetId("56:0x..."),
    symbol="ETH",
    feed_id=FeedId(632),
    token="0x...",              # chain-97 execution token
    decimals=18,
    buy_path=("0x...", "0x..."),
    sell_path=("0x...", "0x..."),
)
```

Generation inputs are the verified Atlas selection, the chain-97 token deployment output and
PancakeSwap route/pool checks. A row is emitted only when:

- The reference asset and Atlas feed are verified.
- The chain-97 token has runtime code and expected decimals.
- The adapter supports the token.
- The oracle supports the token and maps it to the expected feed.
- Both buy and sell paths exist against Flap USD.
- Both paths return a nonzero quote.

Generate a JSON counterpart for the frontend manifest from the same source so Python and
TypeScript cannot drift. The generator must fail on duplicate reference IDs, tokens or feeds.

### Existing tokens versus fresh Flap tokens

The selected MVP option is to reuse the 66 chain-97 constituent token contracts already deployed
for the OpenFour demo, subject to a read-only code/decimals/mint probe. This preserves one execution
token address per reference asset and avoids deploying another 66 ERC-20 contracts. It still
requires a new PancakeSwap pool against Flap USD for every admitted token, plus a new Flap adapter
and oracle instance.

The rejected alternative was to deploy a fresh Flap-specific constituent token set. This isolates Flap pool
reserves and minting from OpenFour, but duplicates symbols and mappings, costs more gas, and makes
the provider selection harder to explain because the same reference asset has different chain-97
addresses. Use this only if the current token contracts cannot be safely minted/funded by the
operator or their behavior is incompatible with the Flap adapter.

Deploy in this order:

1. Promote the existing `AtlasSignedOracle` source from the ignored deployment workspace into the
   reviewed contract tree and deploy a new instance bound to Flap USD and the selected feeds.
2. Basket adapter bound to Flap USD and the selected asset routes.
3. `IndexFiFlapVault` implementation.
4. `IndexFiFlapFactory`; its constructor creates the bound vault factory.
5. Constituent/Flap-USD liquidity pools, funded with mintable Flap USD.

Run the generator and deployment checks across the complete supported intersection, up to all 66
assets. Use a small representative basket for the first full-cycle launch, then cover the remaining
assets with route probes and baskets of at most 32 constituents.

Proposed Flap addresses:

- Portal: `0x000042108465206185A077Edc3F3fd2b49060000`
- Dock Router: `0x000048E888aBf09f690a952E1b386b2D031a0000`
- Guardian: `0x00004d58290854c5E9880F4b5B1993c6Ad8b0000`
- Flap USD: `0x190C989D5665a0e404B444b53CAE9AbCfb600157`
- Whitelist helper: `0x77779969a11eff7582f3bCf48135A846A3457777`

After deployment, the operator simulates and then submits this chain-97 helper call:

```text
whitelist(launcherFactory, 0)
```

Wait for the receipt and verify:

```text
launcherFactoryMultiplier(factory) -> (true, 0)
```

`enabled` is the hard launcher-factory gate. The multiplier is the factory's Flap graduation-floor
multiplier in basis points: `10000` applies the normal floor and lower values discount it. It is not
an IndexFi fee, token tax or per-asset setting. Request `(true, 0)` for the testnet MVP to make the
launcher path as frictionless as Flap permits, then call `graduationFloorV2ForLauncher` to confirm
that the separate creation floor still accepts the fixed 100 Flap-USD pool reserve.

For the testnet MVP, mentor guidance says the helper permits self-configuration at multiplier zero.
Treat that as an assumption to test, not an external blocker. Mainnet remains Flap-controlled and
outside scope. On a local fork, reproduce the helper call or impersonate the authorized Portal role
to configure the same `(true, 0)` state.

If self-whitelisting fails, prepare an evidence package for `@bytes16` and the Flap technical
mentor containing:

- BSC Testnet Launcher Factory and Vault Factory addresses.
- Repository URL and exact source commit.
- Contract verification links.
- Fork results covering launch, deposit and redemption.
- The observed `launcherFactoryMultiplier()` result.
- The failed simulation or transaction hash and decoded revert.

This is a one-time factory onboarding step, not a per-token approval. After the IndexFi factory is
enabled, adding a constituent requires only the IndexFi-controlled token deployment/mint, Flap-USD
pool, adapter route, oracle binding and regenerated mapping. No Flap team action is expected for
each constituent.

The current imported contracts use Pool Launch intentionally. Do not migrate to the newer
permissionless VaultPortal during the hackathon: it uses a bonding-curve architecture, does not
natively match the reserved-supply inventory model, requires a redesign and may not satisfy the
Launcher Factory bounty. Keep the current direct DEX Pool Launch path.

Acceptance:

- Every deployed address has runtime code.
- Factory, vault factory and vault implementation bindings match.
- Factory settlement token is Flap USD with 18 decimals.
- Adapter and oracle support every emitted mapping row.
- Every emitted asset returns nonzero buy and sell quotes.
- The factory is enabled by the Portal.

## 7. Phase C — Add the Flap deployment manifest

Introduce a provider catalogue for chain 97. OpenFour and Flap remain separate deployment records,
and the user selects the launch provider in the creation flow. Provider selection must never change
the user's basket or silently fall back to the other venue.

Suggested public artifacts:

```text
public/deployments/97/index.json
public/deployments/97/openfour.json
public/deployments/97/flap.json
```

`index.json` lists the available providers; each provider file retains its own discriminated
schema and execution assets. The backend contract requires callers to name a provider and never
silently falls back from Flap to OpenFour or vice versa.

Minimum Flap manifest:

```json
{
  "schemaVersion": 6,
  "provider": "flap-direct-v3",
  "fixture": false,
  "chainId": 97,
  "deploymentBlock": 0,
  "factory": "0x...",
  "vaultFactory": "0x...",
  "vaultImplementation": "0x...",
  "portal": "0x000042108465206185A077Edc3F3fd2b49060000",
  "dockRouter": "0x000048E888aBf09f690a952E1b386b2D031a0000",
  "guardian": "0x00004d58290854c5E9880F4b5B1993c6Ad8b0000",
  "settlementToken": "0x190C989D5665a0e404B444b53CAE9AbCfb600157",
  "settlementDecimals": 18,
  "adapter": "0x...",
  "oracle": "0x...",
  "router": "0x...",
  "cap": "...",
  "buyTaxBps": 0,
  "sellTaxBps": 100,
  "taxDuration": 86400,
  "antiFarmerDuration": 0,
  "salt": {
    "suffix": "7777",
    "lockRequired": false
  },
  "features": {
    "rebalancing": false
  },
  "assets": []
}
```

For taxed V3 tokens, salt mining uses the Portal as the CREATE2 deployer and the taxed-token
implementation's EIP-1167 minimal-proxy bytecode. The server hashes from a random seed until the
predicted address ends in `7777`. The chain-97 token implementation address is resolved and pinned
during the fork probe. Salt locking is intentionally omitted: Flap permits a Launcher to skip the
lock, the user sees no salt step, and `saltLockTransaction` remains `null`. A collision or launch
race is handled by mining a fresh salt and preparing a new unsigned transaction.

Update `integration/sync-deployment.mjs` to accept schema V6 and confirm the core bindings through
RPC before copying it into the web application.

The Flap manifest assets are generated from `FLAP_SELECTED_ASSETS`. Two rows are enabled for the
first launch test; the delivered MVP should expose every row that passes the same chain-97 checks,
up to all 66. Market-data availability alone never makes an asset executable.

## 8. Phase D — Implement the Flap launch-preparation BFF

Keep the existing signed-price route:

```http
GET /api/atlas/signed?feeds=632,751
```

Add:

```http
POST /api/flap/launch/prepare
```

Request:

```json
{
  "chainId": 97,
  "creator": "0x...",
  "name": "IndexFi Demo",
  "symbol": "IFDEMO",
  "metadataURI": "ipfs://...",
  "constituents": [
    {"token": "0x...", "weightBps": 5000},
    {"token": "0x...", "weightBps": 5000}
  ],
  "seed": "100000000000000000000",
  "liquidity": "1000000000000000000"
}
```

Response:

```json
{
  "requestId": "123...",
  "salt": "0x...",
  "predictedToken": "0x...",
  "launchAuthorization": "0x...",
  "feedIds": [632, 751],
  "expiresAt": "2026-11-26T16:00:00Z",
  "saltLockTransaction": null
}
```

The route performs only the checks required for a reliable demo:

- Chain ID and address formatting.
- One to 32 unique constituents.
- Positive weights totaling 10,000 bps.
- Every token belongs to the active Flap execution manifest.
- Seed and liquidity meet the deployed factory minimums.
- A random nonzero request ID is unused.
- The vanity salt produces the predicted token address under the fork-confirmed formula.
- `launchAuthorization` is the ABI encoding of the salt.
- The preparation never creates a salt-lock transaction or native lock fee.

Suggested files:

```text
frontend/apps/web/lib/server/flap-manifest.ts
frontend/apps/web/lib/server/flap-salt.ts
frontend/apps/web/lib/server/flap-prepare.ts
frontend/apps/web/app/api/flap/launch/prepare/route.ts
```

The endpoint remains stateless. It does not store launch intents or submit transactions.

## 9. Phase E — Provider client and full-cycle integration runner

Add a provider-discriminated backend client used by integration tests and later handed to the
frontend. For `flap-direct-v3`, it must:

1. Load and validate the Flap manifest from the provider catalogue.
2. Fetch Atlas-signed prices for the selected constituents.
3. Request `/api/flap/launch/prepare`.
4. Submit a salt-lock transaction only if the preparation response requires it.
5. Approve 1,100 Flap USD to the factory: 1,000 seed plus 100 liquidity.
6. Simulate and submit `createVaultWithPrices` from the creator test wallet.
7. Decode `VaultCreated` and `PortfolioLaunched`.
8. Confirm `factory.isVault(vault)` and verify the predicted token and emitted pair.
9. Execute deposit, buy, sell, cash redemption, in-kind redemption and `forwardTaxRevenue`.
10. Reconcile wallet balances, vault collateral, inventory, outstanding supply and emitted events.

The same client contract becomes the later frontend handoff, but no UI work is part of this plan.

## 10. Phase F — MVP verification

Automated checks:

- Existing 18 Flap contract tests pass.
- Existing 31 OpenFour tests pass.
- Manifest V6 parser and provider dispatch tests pass.
- Salt prediction fixtures from the real Portal fork pass.
- Launch-preparation route tests pass.
- BFF typecheck and route tests pass.

Integration-runner flow:

1. Select a valid basket from the generated execution universe, with at most 32 constituents.
2. Prepare and assert the predicted Flap token.
3. Approve Flap USD.
4. Launch the portfolio.
5. Confirm the vault appears in the factory directory.
6. Confirm the Portal, Dock and pair state.
7. Deposit once.
8. Buy and sell the portfolio token once.
9. Redeem once.
10. Redeem in kind once.
11. Forward available tax revenue.

Coverage flow:

1. Probe buy and sell routes for every generated asset.
2. Quote baskets that collectively include every generated asset, in groups of at most 32.
3. Record exclusions with their failed Atlas, token, pool, adapter or oracle check.

Record the factory, vault, token, pair and transaction hashes in the demo handoff.

## 11. Delivery order

```text
A. Generate the full PancakeSwap-plus-Atlas execution mapping
B. Deploy the chain-97 oracle, adapter, vault implementation, Launcher Factory and Vault Factory
C. Attempt helper.whitelist(launcherFactory, 0) on BSC Testnet
D. Verify launcherFactoryMultiplier and both creation/graduation liquidity floors
E. Execute the complete fork demonstration against the deployed configuration
F. Generate the provider catalogue and Flap manifest
G. Implement the launch-preparation route and provider integration runner
H. Execute a public BSC Testnet full-cycle portfolio launch
I. Escalate permission failures with captured evidence only if self-whitelisting fails
```

## 12. Evidence, escalation and fallback

Primary recipients:

- `@bytes16`.
- The Flap technical mentor in the existing hackathon support channel.

Normal acceptance requires a public BSC Testnet launch. A complete fork demonstration is the
fallback if authorization remains blocked, but it does not automatically satisfy the public
testnet bounty requirement. In that case, disclose the exact blocker and obtain explicit organizer
approval before presenting the fork result as the final submission.

Do not respond to an authorization failure by migrating to VaultPortal during the hackathon.

Deferred decision: select the representative basket of at most 32 constituents immediately before
the real full-cycle launch. Automated probes cover every selected asset independently of that
choice.
