# IndexFi — Phase I server

This is a standalone implementation increment, not a deployment or remote
repository change. The project targets Python 3.12. All prices originate from
Atlas WebSocket; no initial HTTP pull, fallback, retries or reconnection.
The server is a local read-only aiohttp service. It waits for one observation
from every selected asset, then samples once per second forever, even after
upstream disconnection. Prices may be old; the collector does not verify
signatures or enforce freshness. USD/USDT parity is assumed, USDC excluded.

## Setup and verification

```sh
cd backend
uv python install 3.12
uv lock
uv sync --all-packages --locked
uv run ruff check --fix packages services tests
uv run ruff format packages services tests
uv run ruff check packages services tests
uv run ruff format --check packages services tests
uv run mypy -p ind_core -p ind_config -p ind_logger -p ind_ws -p ind_atlas -p ind_assets -p ind_snapshot -p ind_fs -p ind_history -p ind_server
uv run pytest -ra
uv run python -m ind_server --help
```

The complete quality gate was verified on 2026-11-25 with CPython 3.12.12:
locked dependency sync, Ruff lint and formatting, strict mypy across the workspace,
40 tests with no skips, and the server entrypoint all passed. Run
`./check.sh` to repeat the same gate. See `TEST_RESULTS.txt` for the recorded
commands and live-integration evidence.

## Live registry verification

```sh
cp .env.example .env
# Edit .env locally and set IND_ATLAS_API_KEY, or export it in the shell.
uv run python -m ind_server.verify --config config.toml --seconds 60
cd ../frontend
corepack pnpm --filter @indexfi/web registry:generate
```

The offline-selection command tests candidate feeds over public and private
channels in bounded windows. It then tries the combined selected subscription.
Only observed feeds are selected. The supplied catalogs contain 66 candidate
assets and 71 candidate feed IDs after excluding USDC and non-pull feeds.
A missing observation is inconclusive, not proof that a feed is unsupported.
Use a longer observation window or smaller candidate batch size (`--batch-size`)
if required. After a combined subscription delivers every selected feed, the
command writes the backend's finalized typed Python module and an intermediate
JSON manifest. The frontend generator joins that manifest with catalog metadata
and writes its finalized typed TypeScript module. Review coverage before starting
the server. This proves observed delivery in the test window, not an exact quota,
future delivery guarantee or signature authenticity.

The source catalogs are preserved under `registry/input/`. The backend imports
`ind_assets.selected`; the frontend imports `data/registry.generated.ts`.
Neither application reads the catalog dumps or JSON manifest at runtime. Rebuild
the affected application after regenerating its finalized source. No network
discovery occurs in either runtime.

## Start

```sh
uv run python -m ind_server --config config.toml
curl -i http://127.0.0.1:8000/snapshot
curl 'http://127.0.0.1:8000/history?start=2026-11-25T17:00:00Z&end=2026-11-25T18:00:00Z'
```

`/snapshot` returns 503 until every selected asset has a price and the next
one-second sample runs. Otherwise it returns `snapshot_at` (UTC ISO 8601) and
`prices` (`asset_id`, `feed_id`, exact decimal string `price`, Unix seconds
`source_timestamp`). `/history` returns `{"snapshots": [...]}` with identical
snapshot objects, sorted by minute. `start` inclusive, `end` exclusive; omit
for the last five minutes. Requests longer than 24 hours return HTTP 400 `invalid_time_range`. Reads enumerate existing minute files in at most 25 UTC hour directories. Repeat `asset_id` query parameters to filter.
Default CORS allows only `http://localhost:3000`. Set the actual frontend
origin in TOML. No API version prefix, health endpoint or asset endpoint.

## CoinMarketCap market data

The approved registry contains all 66 assets. CMC is enabled by default, but provider access is
optional: startup always hydrates and serves persisted history, while collection starts only when
`IND_CMC_API_KEY` is present in the local environment or `.env`. The key is never returned to HTTP
clients. CMC data never changes Atlas prices or contract execution.

The collector polls latest statistics every 15 minutes and requests 30 completed UTC days when a
provider ID has no history. It subsequently appends only observations after that ID's persisted
watermark. It does not search for or repair gaps. Data is retained under `data/cmc/` using exact
decimal strings and atomic Parquet replacement. Provider failures preserve the last valid data.

```sh
curl http://127.0.0.1:8000/v1/cmc/assets
curl http://127.0.0.1:8000/v1/cmc/quotes
curl -G http://127.0.0.1:8000/v1/cmc/history \
  --data-urlencode 'asset_id=56:0x...' --data-urlencode 'asset_id=56:0x...' \
  --data-urlencode 'start=2026-10-27' \
  --data-urlencode 'end=2026-11-26'
```

All three endpoints are local reads and accept repeated `asset_id` filters. History is UTC,
start-inclusive and end-exclusive, with a maximum 365-day request. See
[`docs/CMC_API.md`](docs/CMC_API.md) and the sanitized live fixtures in `docs/fixtures/cmc/`.

CMC mappings are identity/provenance records, not proof of a chain-97 token, DEX route, backing,
or executable price. `exact_token`, `underlying_reference`, and `rwa_aggregate` relationships
must remain distinct. The browser never calls CMC directly and never receives the key.

History is latest-only in RAM plus one pending minute close. Completed UTC
minutes are immutable Parquet files under `data/history/YYYY/MM/DD/HH/MM.parquet`.
The first initialized partial minute is persisted at its closing boundary;
missing minutes are not synthesized. The current minute is not flushed on
shutdown. Existing completed files are not overwritten. Synchronous storage
may block the event loop. Arrow parallel reads are disabled and its pool sizes
limited; aiohttp DNS and native libraries may still use internal threads.
No application-managed threads or executor calls are used.

## Current Phase I status

The selected registry was verified live on 2026-11-25: 70 candidate feeds
were observed, 66 unique assets were selected, the combined subscription
initialized all 66 prices, `/snapshot` and `/history` returned successfully,
and 66-row minute Parquet files were written. This is evidence for the tested
API key and observation window, not a guarantee of future provider delivery,
an exact subscription quota, or signature authenticity.

## Type-safety refinement

All fallible public operations return `Result[T, PackageError]`. Domain absence
uses `Maybe[T]`, including socket closure, pending history and temporary paths.
Use pattern matching for production Result/Maybe handling. `None` is used for
unit return values or native-library boundary representations, not optional
domain state. TOML and secret loading are centralized in `ind_config.loader`
and shared by both entrypoints. `RuntimeConfig` is immutable and nested.
The shell's secret takes precedence over `.env` beside the supplied TOML file.
Configuration paths are resolved relative to the TOML file. `assets.candidates`
is a non-secret configuration path for the offline verifier. See
`REFACTOR_REPORT.md` for current checks and blockers.
