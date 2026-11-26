# IndexFi Backend and Flap Integration Plan

## Objective

Support the IndexFi Flap V3 frontend with signed Atlas prices, verified deployment metadata, and unsigned launch preparation while keeping user custody and transaction submission in the connected wallet.

The existing Python backend remains the market-data service. The Next.js server layer acts as the wallet application's backend-for-frontend (BFF) for signed prices and Flap launch preparation.

## Architecture and responsibility boundaries

```text
Atlas WebSocket
  -> Python backend
  -> latest snapshot, history and CMC APIs

Atlas Pull signed API
  -> Next.js BFF
  -> validated signed payloads for on-chain oracle updates

Browser
  -> Next.js BFF for unsigned preparation
  -> wallet for approvals, salt locking and financial transactions
  -> IndexFi Flap contracts
  -> Flap Portal and Dock
```

The backend must not:

- Hold creator private keys.
- Sign creator transactions.
- Submit settlement approvals.
- Relay create, deposit, redeem, trade, or tax-forwarding transactions.
- Convert unsigned WebSocket observations into purported signed oracle data.
- Treat market-data registry membership as evidence of an executable chain-97 asset.

## 1. Release-blocking protocol verification

Before freezing APIs, verify the exact protocol deployed on chain 97:

- Portal ABI and implementation version.
- Support for `newLauncher` and `launchTaxTokenV2`.
- `lf-v1` launcher-factory behavior.
- `pl-v1` native vault callback behavior.
- Dynamic `FeeConfigVault` encoding.
- Portal salt calculation and required vanity suffix.
- Salt-lock fee, locker identity, ownership verification, and consumption rules.
- Name/symbol anti-scam integration.
- Creator extension support.
- Factory multiplier registration and effective fee.
- Dock Router callback and Token Dock accounting.

The archive targets a direct-launch interface while newer public Flap material may describe different launch entrypoints. Pin the reviewed interface source and deployed bytecode hash. Do not integrate against repository HEAD without reconciling it to chain 97.

## 2. Genuine Atlas oracle verification

The archive does not include the real signed Atlas oracle implementation. The mock signed oracle is not acceptable production evidence.

Obtain and review:

- Signature scheme and domain.
- Authorized signer source and rotation process.
- Payload record encoding.
- Feed-to-asset binding.
- Source and update timestamp rules.
- Maximum age per feed.
- Duplicate-feed behavior.
- Handling of additional unexpected records.
- Settlement-token pricing behavior.
- Replay behavior.
- Failure and rollback semantics.

Acceptance requires signed payloads obtained from the real Atlas Pull API to pass the deployed oracle and invalid/stale payloads to revert.

## 3. Backend service split

### Python market-data service

Keep the current responsibilities:

- `GET /snapshot`
- `GET /history`
- `GET /v1/cmc/assets`
- `GET /v1/cmc/quotes`
- `GET /v1/cmc/history`
- Atlas WebSocket collection.
- Local snapshot and historical persistence.

No Python changes are required for the initial Flap contract integration.

### Next.js BFF

Own these server-side responsibilities:

- Atlas Pull API secret.
- Signed-price request validation.
- Flap launch preparation.
- Vanity-salt computation.
- Construction of an unsigned salt-lock transaction when required.
- Deployment-manifest serving and validation.
- Rate limiting and upstream timeouts.

This keeps the existing server-side signed-price implementation in place and avoids duplicating Atlas Pull logic across Python and TypeScript.

## 4. Deployment manifest V6

Define a provider-aware deployment artifact:

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
  "portal": "0x...",
  "dockRouter": "0x...",
  "guardian": "0x...",
  "settlementToken": "0x190C989D5665a0e404B444b53CAE9AbCfb600157",
  "settlementDecimals": 18,
  "adapter": "0x...",
  "oracle": "0x...",
  "router": "0x...",
  "cap": "...",
  "buyTaxBps": 0,
  "sellTaxBps": 100,
  "taxDuration": 1,
  "antiFarmerDuration": 0,
  "salt": {
    "tokenImplementation": "0x...",
    "suffix": "7777",
    "lockRequired": true,
    "lockFeeWei": "..."
  },
  "assets": []
}
```

The synchronization command must fail unless read-only RPC checks confirm:

- The configured chain ID.
- Runtime code at every contract address.
- Factory settlement token, adapter, oracle, router, Portal, Dock, and Guardian bindings.
- Factory-to-vault-factory and vault-factory-to-factory bindings.
- Vault implementation code and immutable behavior.
- Settlement token decimals.
- Factory multiplier enabled state and expected multiplier.
- Adapter and oracle support for every listed asset.
- Exact reference asset and feed mapping.
- No duplicate token, reference asset, or feed.
- No mock token in a production manifest.

Store generated ABIs beside the manifest and validate required function/event presence during synchronization.

## 5. Chain-97 execution registry

Create a dedicated execution registry rather than reusing all market-data assets.

Each execution asset must record:

```ts
type ExecutableAsset = {
  address: Address;
  symbol: string;
  decimals: number;
  referenceAssetId: string;
  feedId: number;
  buyPath: Address[];
  sellPath: Address[];
  maxPriceAgeSeconds: number;
  testAsset: boolean;
};
```

Admission checks:

- Token contract code exists.
- Decimals match the manifest.
- Oracle supports the token and is bound to the expected feed.
- Adapter supports the token.
- Every route pool exists.
- Nonzero buy and sell quotes are available.
- A one-unit execution probe is within the contract's configured price-deviation threshold.
- The token is not knowingly fee-on-transfer or frozen unless the vault behavior has been explicitly reviewed for it.

Start with two executable constituents. Expand only after per-asset acceptance tests pass.

## 6. Signed-price API

Retain:

```http
GET /api/atlas/signed?feeds=751,632
```

Successful response:

```json
{
  "payloads": ["0x..."],
  "signatures": ["0x..."]
}
```

Validation requirements:

- Require at least one feed and no more than 32 feeds.
- Require positive decimal feed IDs.
- Reject duplicates.
- Permit only feed IDs from the active execution manifest.
- Split upstream requests according to the verified Atlas per-payload limit.
- Require exactly one signature per payload.
- Require 65-byte signatures if confirmed by the genuine oracle format.
- Decode each returned payload.
- Require exact requested/returned feed equality for every chunk.
- Reject unexpected extra feeds.
- Reject stale and implausibly future-dated records.
- Use an upstream timeout.
- Apply bounded retry only to safe network/provider failures.
- Return `Cache-Control: no-store`.
- Do not include the Atlas API key in client-visible errors or logs.

Suggested errors:

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `invalid_feeds` | Malformed, duplicate, excessive, or unsupported feeds |
| 409 | `deployment_changed` | Active deployment changed during the request |
| 502 | `atlas_unavailable` | Provider or transport failure |
| 502 | `atlas_malformed` | Invalid provider response |
| 503 | `atlas_key_missing` | Server secret not configured |
| 503 | `atlas_stale` | Provider returned unusably old observations |
| 429 | `rate_limited` | Caller exceeded the signed-price request limit |

## 7. Flap launch-preparation API

Add:

```http
POST /api/flap/launch/prepare
```

Request:

```json
{
  "chainId": 97,
  "creator": "0x...",
  "basket": {
    "name": "Index name",
    "symbol": "IDX",
    "metadataURI": "ipfs://...",
    "constituents": [
      {"token": "0x...", "weightBps": 5000},
      {"token": "0x...", "weightBps": 5000}
    ]
  },
  "seed": "100000000000000000000",
  "liquidity": "10000000000000000000",
  "slippageBps": 100
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
  "expiresAt": "2026-11-26T12:00:00Z",
  "saltLockTransaction": {
    "to": "0x...",
    "data": "0x...",
    "value": "..."
  }
}
```

The endpoint must:

- Validate the chain ID and creator address.
- Validate 1-32 unique constituents.
- Require positive weights totaling 10,000 bps.
- Resolve every token through the active execution manifest.
- Validate seed and liquidity against on-chain minimums.
- Validate slippage against the application's maximum.
- Validate name, symbol, and metadata URI according to confirmed protocol rules.
- Generate a cryptographically random nonzero 256-bit request ID.
- Check `factory.usedRequestIds(requestId)` and regenerate on collision.
- Mine a vanity salt using the verified Portal and token implementation.
- Compute the predicted CREATE2 token address independently.
- Confirm the predicted address has the configured suffix.
- Encode `launchAuthorization` as `abi.encode(bytes32 salt)`.
- Construct, but never sign, the salt-lock transaction when required.
- Return a short expiry.

The final wallet simulation remains authoritative. The backend must not return a claim that a launch will succeed.

## 8. Salt handling

Salt behavior is a release gate because the IndexFi factory calls the Portal through nested factory and launcher contracts.

After the deployed behavior is verified:

- Use the Portal address as the CREATE2 deployer if that matches the deployed implementation.
- Use the exact deployed tax-token implementation bytecode in prediction.
- Use cryptographically random salt seeds.
- Verify the suffix after prediction.
- Do not reuse salts.
- Do not log salts before the client receives them when front-running protection is relevant.
- If locking is required, return the exact Portal destination, calldata, and native value.
- Provide a read method or helper to verify the lock owner and token version before creation.

If the Portal requires the creator to be the direct launcher but the nested IndexFi launch makes the factory or launcher appear as caller, stop integration and change the contract design or obtain a verified protocol-supported flow. Do not work around this in the backend.

## 9. State and persistence

The MVP launch-preparation endpoint should be stateless.

On-chain state provides:

- Salt-lock ownership.
- Salt consumption.
- `usedRequestIds`.
- Successful vault registration.
- Transaction receipts and events.

Introduce persistent launch intents only if a verified multi-step flow requires recovery or operational visibility. If added, use a transactional database with:

- Intent ID.
- Chain ID and factory address.
- Creator address.
- Request ID.
- Salt hash and predicted token.
- Canonical request hash.
- Expiry.
- Lock transaction hash.
- Launch transaction hash.
- Status and last confirmed block.

Add unique constraints for `(chain_id, factory, request_id)` and `(chain_id, portal, salt)`.

Do not store private keys or wallet signatures.

## 10. Optional event indexer

The indexer is not required for the first working launch because the factory exposes `vaultCount` and `vaultAt`.

When added, index from `deploymentBlock`:

- `FlapLauncherRegistered`
- `VaultCreated`
- `PortfolioLaunched`
- `Deposited`
- `Redeemed`
- `RedeemedAsset`
- `RedeemedInKind`
- `VaultClosed`

Indexer requirements:

- Store block number, block hash, transaction hash, log index, and decoded fields.
- Use `(chain_id, transaction_hash, log_index)` as an idempotency key.
- Track a confirmation depth.
- Detect block-hash changes and roll back orphaned events.
- Backfill in bounded block ranges.
- Reconcile indexed vaults with `factory.isVault`.
- Never infer financial balances solely from events; use current contract reads for authoritative portfolio state.

Potential endpoints:

```http
GET /api/flap/vaults
GET /api/flap/vaults/{address}
GET /api/flap/transactions/{hash}
```

## 11. Security controls

- Keep `ATLAS_API_KEY` server-only.
- Separate public RPC URLs from secrets.
- Apply strict schema validation and request-size limits.
- Rate-limit signed-price and salt-mining endpoints.
- Use same-origin access for BFF endpoints.
- Use `Cache-Control: no-store` for signed data and launch preparations.
- Use upstream timeouts and response-size limits.
- Validate all addresses with checksum normalization.
- Bind every request to the active chain and deployment version.
- Fail closed if the deployment manifest changes during preparation.
- Do not accept arbitrary token or feed mappings from the browser.
- Do not accept arbitrary Portal or token-implementation addresses.
- Redact secrets and authorization headers from errors and logs.
- Emit structured metrics without signed payload bodies.

Recommended metrics:

- Signed-price request count and latency.
- Atlas upstream error count by class.
- Stale/malformed payload count.
- Launch-preparation count and latency.
- Salt-mining iteration count.
- Unsupported asset attempts.
- Manifest/RPC validation failures.
- Indexed block lag and reorg count.

## 12. Backend testing

### Unit tests

- Deployment manifest parsing and binding validation.
- Exact feed coverage.
- Duplicate, extra, missing, stale, and future records.
- Atlas error sanitization.
- Basket and weight validation.
- Random nonzero request-ID generation.
- CREATE2 salt prediction and suffix validation.
- ABI encoding of `bytes32` launch authorization.
- Unsigned salt-lock transaction construction.
- Rate limiting and request-size boundaries.

### Contract integration tests

- Signed payload accepted by the genuine oracle.
- Invalid signer rejected.
- Altered payload rejected.
- Stale payload rejected.
- Price update and financial action roll back together.
- Factory request-ID collision detection.
- Salt lock created by the correct caller.
- Wrong locker rejected.
- Reused salt rejected.
- Prepared token address equals the emitted token address.

### Real-Portal fork acceptance

- Verify deployed helper ABI before invoking whitelist configuration.
- Verify `launcherFactoryMultiplier(factory)`.
- Launch with 0 and 1 bps multiplier configurations.
- Test tax durations 0 and 1.
- Verify behavior before expiry, after expiry, and after the first post-expiry sell.
- Test actual 18-decimal test USD.
- Test at least two executable constituents.
- Verify Portal vault records and Dock balances.
- Verify LP burn and exact share transfers.
- Verify failed callbacks roll back the complete launch.
- Record chain, fork block, transaction hashes, and deployed bytecode hashes.

## 13. Operational deployment plan

1. Pin the reviewed Flap interface source and chain-97 deployment block.
2. Deploy and verify the genuine Atlas-compatible oracle.
3. Deploy the adapter with only reviewed routes.
4. Deploy the standalone vault implementation.
5. Deploy `IndexFiFlapFactory`, which creates its bound vault factory.
6. Verify all immutable bindings.
7. Register/enable the factory using the verified protocol procedure.
8. Generate manifest V6 and ABI artifacts.
9. Run manifest synchronization and RPC validation.
10. Deploy the BFF with `ATLAS_API_KEY` configured.
11. Execute signed-price and launch-preparation smoke tests.
12. Execute the real-Portal fork acceptance suite.
13. Perform a limited chain-97 two-asset launch.
14. Enable public creation only after receipt and accounting reconciliation.

## 14. Delivery sequence

1. Resolve protocol-version, salt-lock, and anti-scam gates.
2. Obtain and validate the genuine signed oracle.
3. Define manifest V6 and the chain-97 execution registry.
4. Extend deployment synchronization and preflight checks.
5. Harden the signed-price BFF.
6. Implement stateless launch preparation.
7. Add integration tests with a local Flap fixture.
8. Pass the real-Portal fork suite.
9. Run a limited chain-97 launch.
10. Add the optional event indexer after the transaction path is stable.

## Definition of done

- The BFF returns fresh, structurally valid Atlas-signed payloads only for approved execution feeds.
- The genuine on-chain oracle accepts those payloads and rejects invalid or stale ones.
- Launch preparation returns a nonzero unused request ID, a correct vanity salt, the correct predicted token, and ABI-encoded salt authorization.
- Any required salt-lock transaction is constructed from verified deployed interfaces and can be submitted by the correct wallet.
- The backend never holds a creator key or submits financial transactions.
- Manifest synchronization verifies all contract bindings and execution assets against RPC state.
- A two-asset launch passes local integration, real-Portal fork, and chain-97 acceptance tests.
- Failed launches roll back request IDs, funds, prepared vault state, and oracle updates atomically.

