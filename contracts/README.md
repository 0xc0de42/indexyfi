# IndexFi smart-contract workspace

Read the [public vault implementation plan](IMPLEMENTATION_PLAN.md) for the current
contract signatures, accounting rules and delivery sequence. The earlier
[architecture draft](ARCHITECTURE.md) retains reference pins and starter research.

```sh
cd contracts/openfour
npm ci
npm run compile
npm test
```

The OpenFour starter and package lock are preserved. Compiler: solc 0.8.24,
optimizer 200, viaIR; OpenZeppelin 4.9.6. Local Hardhat is the default network.
The IndexFi factory, public basket vault, non-transferable share token, preset,
validator and local swap fixture are implemented. The local lifecycle deploys
with:

```sh
npx hardhat node
npx hardhat run scripts/deploy-indexfi.js --network localhost
```

The deploy script writes `deployments/31337.json`, its ABI files, and the web
manifest at `frontend/apps/web/public/deployments/31337.json`.

Run the complete local application verification from the repository root:

```sh
cd integration
npm ci
npm test
```

That runner starts a local chain, contracts, the real aiohttp application with
deterministic Atlas websocket observations, and the Next application. A real
browser with two injected wallets performs create, discover, deposit and a
profitable redemption.

Registration/lifecycle scripts require FORK_JSON pointing to a developer-owned
deployment. Their upstream sibling-directory discovery assumes the original
OpenFour repo layout; set FORK_JSON explicitly here and use the pinned source
checkout under api-discovery/sources/openfour-docs for fork-deploy/workbench.
Do not treat the sample FairLaunch preset as a collateralized portfolio. The
official Core requires `launchAuthorization` from its configured signer. The
local `MockIndexFiCore` deliberately accepts an empty authorization; a public
testnet launch needs an authorized signature-delivery service and must never
put the signer key in the browser or this repository.
