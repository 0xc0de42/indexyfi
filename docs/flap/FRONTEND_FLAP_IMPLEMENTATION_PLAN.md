# IndexFi Frontend and Flap Contract Integration Plan

## Objective

Integrate the IndexFi Flap V3 contracts into the existing web application while preserving the current OpenFour/local-fixture path until the Flap deployment is validated. The connected wallet remains the creator and transaction sender. The frontend must never rely on unsigned prices, zero slippage protection, or unverified deployment addresses.

## Preconditions and release gates

Public creation must remain disabled until all of the following are resolved:

- Confirm the chain-97 Portal supports the archive's `lf-v1`, `pl-v1`, `newLauncher`, and `launchTaxTokenV2` interfaces.
- Confirm the deployed Portal, Dock Router, Guardian, whitelist helper, and tax-token implementation addresses.
- Establish the exact salt-mining, salt-locking, lock-fee, and locker-identity rules.
- Obtain and validate the genuine Atlas signed oracle implementation and wire format.
- Confirm anti-scam name/symbol validation and creator-extension behavior.
- Produce a chain-97 execution registry containing only tokens with verified Atlas feeds and executable adapter routes.
- Pass a launch against a fork of the real Portal and Dock contracts; `MockFlapPortal` is not sufficient acceptance evidence.

## Target user flow

```text
Choose basket
  -> validate executable assets and weights
  -> fetch signed Atlas prices
  -> simulate a price-updating quote
  -> prepare request ID and Flap salt
  -> lock salt if required
  -> approve settlement token
  -> simulate createVaultWithPrices
  -> submit with connected wallet
  -> decode and verify launch events
  -> open the new vault portfolio page
```

The backend prepares unsigned data only. The browser wallet approves and broadcasts every state-changing transaction.

## 1. Provider-aware deployment manifest

Replace the OpenFour-only manifest model with a discriminated provider schema.

```ts
type FlapDeployment = {
  schemaVersion: 6;
  provider: "flap-direct-v3";
  fixture: boolean;
  chainId: number;
  deploymentBlock: number;

  factory: Address;
  vaultFactory: Address;
  vaultImplementation: Address;
  portal: Address;
  dockRouter: Address;
  guardian: Address;

  settlementToken: Address;
  settlementDecimals: number;
  adapter: Address;
  oracle: Address;
  router: Address;

  cap: string;
  buyTaxBps: number;
  sellTaxBps: number;
  taxDuration: number;
  antiFarmerDuration: number;

  salt: {
    tokenImplementation: Address;
    suffix: string;
    lockRequired: boolean;
    lockFeeWei: string;
  };

  assets: ExecutableAsset[];
};
```

Frontend manifest validation must reject:

- A chain ID different from the connected RPC.
- Missing or zero contract addresses.
- Wrong settlement token or decimals.
- Duplicate execution token, reference asset, or feed mappings.
- Mock assets on a non-fixture deployment unless the deployment explicitly identifies itself as a public test-asset deployment.
- Assets absent from the finalized frontend reference registry.
- A vault whose `factory()` does not equal the configured factory.

## 2. ABI integration

Import the generated ABIs supplied with the Flap V3 package:

```text
frontend/apps/web/abi/IndexFiFlapFactory.json
frontend/apps/web/abi/IndexFiFlapVault.json
frontend/apps/web/abi/IndexFiFlapVaultFactory.json
frontend/apps/web/abi/IndexFiFlapLauncher.json
```

Required factory methods and events:

- `minimumSeed`
- `minimumLiquidity`
- `previewCreate`
- `quoteCreateWithPrices`
- `createVault`
- `createVaultWithPrices`
- `usedRequestIds`
- `isVault`
- `vaultCount`
- `vaultAt`
- `VaultCreated`
- `PortfolioLaunched`
- `FlapLauncherRegistered`

Required vault methods and events:

- `constituents`
- `previewDeposit`
- `quoteDepositWithPrices`
- `deposit`
- `depositWithPrices`
- `previewRedeem`
- `previewRedeemAssets`
- `previewRedeemInKind`
- `redeem`
- `redeemWithPrices`
- `redeemInKind`
- `redeemInKindWithPrices`
- `forwardTaxRevenue`
- `Deposited`
- `Redeemed`
- `RedeemedAsset`
- `RedeemedInKind`
- `VaultClosed`

Add an ABI parity test so a missing or changed required method fails CI.

## 3. Frontend contract-provider abstraction

Refactor the current contract integration into provider-specific modules:

```text
frontend/apps/web/lib/contracts/common.ts
frontend/apps/web/lib/contracts/manifest.ts
frontend/apps/web/lib/contracts/openfour.ts
frontend/apps/web/lib/contracts/flap.ts
frontend/apps/web/lib/contracts/prices.ts
```

Expose a common interface:

```ts
interface VaultProvider {
  listVaults(): Promise<Address[]>;
  readVault(address: Address): Promise<VaultSnapshot>;
  prepareCreate(input: CreateInput): Promise<CreatePreparation>;
  create(input: PreparedCreate): Promise<Hash>;
  deposit(input: DepositInput): Promise<Hash>;
  redeem(input: RedeemInput): Promise<Hash>;
  redeemInKind(input: RedeemInKindInput): Promise<Hash>;
}
```

Select the implementation using `deployment.provider`. Keep the fixture/OpenFour implementation operational while Flap is being validated.

## 4. Basket validation

Before quoting or preparing a launch, enforce:

- Between 1 and 32 constituents.
- No repeated token addresses.
- Every asset exists in the active execution manifest.
- Every weight is positive.
- Weights total exactly 10,000 bps.
- Seed is at least `minimumSeed()`.
- Liquidity is at least `minimumLiquidity()`.
- Name and symbol are nonempty and comply with verified Flap anti-scam rules.
- Metadata URI has the accepted format.
- Settlement amounts use the deployment's actual decimals; chain 97 currently expects the configured 18-decimal test USD.

The basket editor must show only executable assets. The 66-asset market-data registry must not be treated as proof that an asset is launchable on chain 97.

## 5. Signed price and quote flow

For creation and deposits:

1. Resolve constituent token addresses to manifest feed IDs.
2. Request fresh signed payloads from `/api/atlas/signed`.
3. Call `quoteCreateWithPrices` or `quoteDepositWithPrices` through `eth_call`/`simulateContract` only.
4. Calculate per-leg minimums from the simulated result.
5. Re-fetch prices if the quote becomes stale before transaction simulation.

Quote wrappers are non-view because they call `oracle.updatePrices`. Sending them as transactions would persist price updates and must be prevented.

Redemption does not require oracle prices for its underlying financial operation. The UI may prefer a `WithPrices` wrapper but must offer an explicit fallback to the ordinary redemption method if optional price posting fails.

## 6. Flap launch preparation

Replace the public OpenFour signer flow with the Flap launch-preparation API.

Expected response:

```ts
type FlapLaunchPreparation = {
  requestId: bigint;
  salt: Hex;
  predictedToken: Address;
  launchAuthorization: Hex;
  feedIds: number[];
  expiresAt: string;
  saltLockTransaction: {
    to: Address;
    data: Hex;
    value: bigint;
  } | null;
};
```

The `launchAuthorization` must be ABI encoding of a single `bytes32` salt. It is not an OpenFour EIP-191 signature.

Remove `launchDigest`, `launchSigner`, and the Core signer requirement from the Flap branch. Retain them only for a separately identified OpenFour provider.

## 7. Creation transaction sequence

Implement creation in this order:

1. Verify the wallet account and chain.
2. Validate the basket against the active deployment.
3. Fetch signed prices.
4. Simulate `quoteCreateWithPrices`.
5. Derive `minTokenOut[]` and `minCreatorShares` from the user's slippage setting.
6. Request a launch preparation from `/api/flap/launch/prepare`.
7. Confirm the returned request has not expired.
8. If salt locking is required, prompt the wallet to submit the returned lock transaction.
9. Wait for the configured confirmations and verify the salt lock on-chain.
10. Approve `seedUSDT + liquidityUSDT` to the IndexFi Flap factory.
11. Confirm `usedRequestIds(requestId)` is false.
12. Simulate `createVaultWithPrices` with the wallet address as `account`.
13. Apply the reviewed gas strategy and submit the simulated request.
14. Wait for a successful receipt.
15. Decode `VaultCreated` and `PortfolioLaunched` from the configured factory.
16. Verify creator, request ID, vault, token, pair, and `factory.isVault(vault)`.
17. Invalidate directory, portfolio, wallet-balance, and allowance queries.

Do not retry a submitted financial transaction automatically. A request-ID collision before submission can generate a fresh preparation; a mined or pending transaction requires explicit user review.

## 8. Creation user interface

Update the creation UI to display the following transaction states:

- Validating basket
- Fetching signed prices
- Quoting basket acquisition
- Preparing Flap token address
- Reserving token address
- Approving settlement token
- Simulating launch
- Waiting for wallet confirmation
- Waiting for receipt
- Verifying vault

Before wallet confirmation, display:

- Predicted portfolio-token address.
- Seed collateral and pool liquidity separately.
- Estimated creator shares.
- Buy and sell tax rates and tax duration.
- IndexFi's 10 bps deposit and redemption fee.
- Native salt-lock fee, if any.
- Per-leg slippage floors.
- Initial LP burn behavior.
- Immutability of the vault logic.
- A warning that `phase() == Migrated` describes the IndexFi DEX-ready state, not Flap graduation status.

## 9. Deposit flow

1. Read constituents directly from the vault.
2. Verify every constituent against the deployment manifest.
3. Fetch signed Atlas prices for those feeds.
4. Simulate `quoteDepositWithPrices`.
5. Calculate `minShares` and per-leg `minimums`.
6. Approve settlement input to the vault.
7. Simulate `depositWithPrices`.
8. Submit and verify the `Deposited` event.
9. Refresh holdings, supply, inventory, NAV, AUM, and wallet balances.

Do not silently fall back to ordinary `deposit` when signed-price delivery fails. Deposits depend on current oracle valuation.

## 10. Redemption flows

### Cash redemption

1. Call `previewRedeemAssets(holder, shares)`.
2. Apply the slippage floor independently to every nonzero leg.
3. Calculate an aggregate `minNetUSDT`.
4. Approve portfolio shares to the vault.
5. Prefer `redeemWithPrices` when fresh signed prices are available.
6. Allow an explicit fallback to ordinary `redeem` if optional posting fails.
7. Verify the `Redeemed` event and resulting balances.

### In-kind redemption

1. Call `previewRedeemInKind(holder, shares)`.
2. Display gross, creator fee, and net amount for every asset.
3. Apply per-asset minimums.
4. Approve portfolio shares.
5. Submit `redeemInKindWithPrices` or an explicit fallback to `redeemInKind`.
6. Decode and verify every `RedeemedAsset` event plus `RedeemedInKind`.

Never use zero minimums for nonzero expected outputs.

## 11. Flap-aware secondary trading

Use the token and pair emitted by `PortfolioLaunched`. Do not assume an OpenFour-created pair.

The trading UI must:

- Display buy and sell tax separately.
- Estimate the post-tax amount received.
- Read the actual tax state from the verified Flap token or Portal interface.
- Distinguish Flap market/graduation status from the vault's `phase()`.
- Warn about sell-triggered tax expiry only if confirmed by fork tests.
- Display unaccounted settlement surplus eligible for `forwardTaxRevenue`.
- Optionally expose permissionless tax forwarding as a separate, explicit transaction.

## 12. Vault directory and portfolio reads

For each vault:

- Confirm `factory.isVault(vault)`.
- Confirm `vault.factory()` matches the deployment factory.
- Read all state at a consistent block number.
- Verify every constituent belongs to the execution manifest.
- Treat `nav()` and `collateralValue()` failures as unavailable valuation, not automatic vault failure.
- Keep redemption available when optional price display is unavailable.
- Display outstanding supply separately from token inventory and wallet balances.

Initially, `vaultCount()` and `vaultAt()` can power discovery. Switch to the backend indexer when event volume or RPC latency warrants it.

## 13. Error handling

Map common failure classes to actionable UI messages:

- Wrong chain or wallet changed.
- Deployment manifest/RPC mismatch.
- Unsupported asset or missing execution route.
- Atlas unavailable, malformed, or stale.
- Salt already locked or used.
- Request ID already used.
- Insufficient settlement balance.
- Settlement approval insufficient.
- Deadline expired.
- Per-leg or aggregate slippage failure.
- Execution-price deviation above the contract threshold.
- Inventory insufficient for deposit.
- Frozen or fee-on-transfer constituent preventing in-kind redemption.
- Factory not enabled or invalid multiplier.

Preserve raw transaction hashes and decoded contract error names for diagnostics without exposing secrets.

## 14. Frontend tests

### Unit tests

- Manifest V6 parsing and rejection cases.
- Provider dispatch.
- ABI parity.
- Salt authorization encoding.
- CREATE2 predicted-token computation.
- Feed resolution and exact coverage.
- Price freshness handling.
- Per-leg and aggregate slippage floors.
- Event decoding and receipt verification.
- Tax-aware trade estimates.
- Rejection of reference-only assets.

### Integration tests

- Local Flap fixture creation.
- Optional salt-lock transaction.
- Creation with valid signed prices.
- Stale and invalid signed-price rejection.
- Request-ID collision recovery before submission.
- Deposit and insufficient-inventory failure.
- Cash redemption.
- In-kind redemption and per-asset events.
- Tax-aware buy and sell.
- Directory discovery and consistent vault snapshot.

### Browser end-to-end test

Extend the existing integration runner to:

1. Deploy a local Flap-compatible fixture.
2. Generate and synchronize a V6 manifest.
3. Start the Python market-data service and Next.js app.
4. Create a two-asset portfolio through the browser.
5. Deposit.
6. Buy and sell the portfolio token.
7. Redeem partially to settlement.
8. Redeem the remainder in kind.
9. Verify events, balances, fees, inventory, and directory discovery.

## 15. Delivery sequence

1. Add manifest V6 and generated ABIs.
2. Add provider-specific contract modules.
3. Implement and test Flap launch preparation consumption.
4. Replace the public OpenFour authorization branch for Flap.
5. Implement create simulation, submission, and receipt verification.
6. Implement signed-price deposits.
7. Implement cash and in-kind redemptions.
8. Add Flap-aware trading and tax display.
9. Extend integration and browser tests.
10. Enable public creation only after all release gates pass.

## Definition of done

- A wallet can create a two-asset portfolio against the verified Flap testnet path.
- The UI uses a mined and, when required, locked salt rather than an OpenFour signature.
- All execution assets come from a verified chain-specific manifest.
- Signed prices are used for creation and deposits and validated by the real on-chain oracle.
- Creation, deposit, cash redemption, and in-kind redemption enforce meaningful minimums.
- Receipts and contract events are decoded and verified before the UI reports success.
- Secondary trading is tax-aware.
- Local integration, real-Portal fork, and chain-97 acceptance suites pass.

