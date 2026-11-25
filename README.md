# IndexFi

IndexFi is a BNB Chain hackathon prototype for launching fixed-supply,
buy-and-hold portfolio tokens through OpenFour. The intended mechanism combines
separate constituent custody, OpenFour market inventory and settlement, Atlas
reference prices, and PancakeSwap acquisition and post-graduation liquidity.

The repository currently contains the frontend prototype and the official
OpenFour starter used as the smart-contract foundation. Portfolio-specific
contracts and the Python price-stream server are under development.

## Repository layout

```text
frontend/             Next.js frontend workspace
contracts/            OpenFour starter and contract architecture
backend/              Reserved for the Python API and price-stream server
dump/                 Ignored local research, asset-sync pipeline and evidence
```

## Asset catalog

A local, ignored Python pipeline (`dump/asset-sync/`) matches PancakeSwap's
BNB Chain token list with the Atlas feed catalog. It reduces every asset to
exactly one Atlas pull feed (policy A2):

- the feed must be pull-enabled and quoted in USD;
- pull-API access is verified with `ATLAS_API_KEY`;
- standard volume-weighted feeds are preferred;
- any remaining ambiguity is resolved by an explicit, reviewed override.

Push heartbeat and deviation parameters are ignored, because prices are pulled
every second.

The pipeline publishes two things to the frontend:

- `frontend/apps/web/data/commonAssets.ts`: generated asset metadata (chain ID,
  address, decimals, logo path) plus `ATLAS_FEED_ID_BY_ASSET_ID` and
  `ATLAS_FEED_IDS`. It contains no provider URLs.
- `frontend/apps/web/public/assets/logos/56/`: address-keyed token logos.

A match is asset-level identity only. It does not prove backing, fungibility,
price equivalence or executable liquidity.

## Live prices

The frontend never calls Atlas. It subscribes to the Python server's WebSocket
(`NEXT_PUBLIC_PRICE_WS_URL`, default `ws://127.0.0.1:8000/ws/prices`):

```text
client → server  {"type":"subscribe","feedIds":[632,647,...]}
server → client  {"type":"prices","prices":[{"feedId":632,"price":1659.42,
                  "timestamp":1795627291,"consensusStatus":"HEALTHY"}]}
server → client  {"type":"error","message":"..."}
```

`price` is in USD and `timestamp` is the Atlas price time in Unix seconds.
Updates may be partial. The client resubscribes after every reconnect, and
treats a price as stale after 10 seconds. Atlas's signed pull endpoint accepts
at most 20 feed IDs per request (observed 2026-11-25), so the server must chunk
its pulls. The Assets page (`/assets`) shows every catalog asset with its logo,
contract, selected feed, live price, age and consensus status.

## Run the frontend

```sh
cd frontend
corepack pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local
corepack pnpm dev
```

The default mode is an explicitly simulated local preview. API mode remains
read-only until the verified backend and transaction adapter are connected.

## Validate the OpenFour foundation

```sh
cd contracts/openfour
npm ci
npm run compile
npm test
```

The starter uses Solidity 0.8.24, optimizer runs 200, `viaIR`, and OpenZeppelin
4.9.6. Read [the contract architecture](contracts/ARCHITECTURE.md) before adding
portfolio modules. No public-chain write or deployment is performed by these
commands.

## Security and data rules

- Never commit private keys, API keys, wallet secrets or private RPC URLs.
- Keep provider credentials in the backend environment.
- Identify assets by chain ID and contract address, never by ticker alone.
- Label live, derived, cached and simulated values in API responses and the UI.
- Do not describe test tokens as legally redeemable securities or guarantee a
  NAV exit before those rights and accounting are implemented and reviewed.
- Register OpenFour modules only on a developer-owned Fork Registry.

## Hackathon submission

Submission is made through the BNB Bangkok project page on HackQuest. The team
must register, receive approval, confirm participation, create or join the team
project, select at least one track, add the repository and demo details, submit,
and verify the confirmation before the deadline.

Target requirements:

- Developer Track: build on BNB Chain.
- OpenFour: working prototype with meaningful integration, GitHub repository,
  2–3 minute demo, and a concise problem/audience/differentiation description.
- CoinMarketCap × Atlas: meaningful live data in a core feature, BNB deployment
  or data, judge-accessible code, setup instructions, demo up to three minutes,
  one-page write-up, addresses/data used, future work and team contacts.

Use testnet or clearly labeled mocks for basket-style financial concepts unless
independently reviewed. Repository publication alone does not submit the entry.

Official references:

- [BNB Bangkok and submission instructions](https://www.hackquest.io/hackathons/BNB-Bangkok)
- [OpenFour developer guide](https://github.com/four-meme-community/openfour-docs/blob/main/docs/developer-guide.md)
- [Atlas documentation](https://docs.atlasoracle.io/)
- [CoinMarketCap API documentation](https://coinmarketcap.com/api/documentation/)
