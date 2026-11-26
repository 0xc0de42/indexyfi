# CoinMarketCap HTTP API

These endpoints expose approved CMC identity and market data. They never perform an upstream
request while handling HTTP traffic. Decimal values are JSON strings so browser clients do not
lose precision. `asset_id` is the canonical IndexFi chain-and-address identity.

Repeat `asset_id` to select multiple assets. With no filter, the endpoints return all approved
assets in canonical registry order. An unknown ID returns HTTP 400:

```json
{"error":"unknown_asset","asset_ids":["unknown"]}
```

## `GET /v1/cmc/assets`

Returns static, operator-approved identities. Each item contains `asset_id: string`,
`symbol: string`, and a `mapping` with `cmc_id: integer`, `kind: "crypto" | "rwa"`,
`relation: "exact_token" | "underlying_reference" | "rwa_aggregate"`, and `evidence: string`.

Fixture: [`assets.json`](fixtures/cmc/assets.json).

## `GET /v1/cmc/quotes`

Returns latest in-memory statistics. Each item repeats the asset identity and contains:

- `status`: `available`, `pending`, or `error`.
- `quote`: `null` before a valid arrival, otherwise provider timestamp, exact price, market cap,
  24-hour volume, rank, tags, percentage changes, and provenance.
- `error`: an optional typed provider error code. A failed refresh does not remove an older quote.

Without a CMC key the endpoint remains available and returns `pending` quotes after restart.
Latest quotes are intentionally not persisted. Fixture: [`quotes.json`](fixtures/cmc/quotes.json).

## `GET /v1/cmc/history`

Parameters are repeated `asset_id`, `start=YYYY-MM-DD`, and `end=YYYY-MM-DD`. Start is inclusive,
end is exclusive, and the maximum range is 365 days. The default end is the current UTC date and
the default start is 30 days earlier. Future ends, malformed dates, empty ranges, and oversized
ranges return HTTP 400 `invalid_date_range`.

The response contains `source`, `start`, `end`, and `series`. Every series has its asset and
mapping, `status`, and observed `points`. Point fields are `day`, provider `timestamp`, nullable
exact `price`, `market_cap`, `volume_24h`, and provenance. Missing days remain absent. One missing
or failed asset does not fail other requested assets.

Persisted Parquet is hydrated before the server starts listening, including when no CMC key is
configured. Fixture: [`history.json`](fixtures/cmc/history.json).

## Availability and errors

An intentionally disabled or invalid CMC registry returns HTTP 503 `cmc_disabled`. Partial data is
otherwise HTTP 200 with per-asset status/error fields. CMC mappings describe provider identity;
they do not prove chain-97 backing, liquidity, a DEX route, or an executable price.
