# IndexFi — Server implementation plan V3

Date: 2026-11-25
Scope: A2 — Redeemable Basket; local development and hackathon demo.
Status: implementation baseline for market data; storage, mathematics and final API details remain open for discussion.

This document supersedes the backend architecture in `02-BACKEND.md`. It specifies the server, not the complete IndexFi protocol. Decisions labeled **proposed** are not yet approved. External capabilities labeled **unverified** must not be treated as working integrations.

## 1. Objective and scope

Build one small, typed Python service that subscribes to Atlas prices over WebSocket, maintains the latest price of each selected asset, produces a complete immutable snapshot every second after initialization, and exposes data locally to the frontend. Persist completed UTC minute closes in Parquet.

The server is a read-only market-data service. It does not manage wallets, execute transactions, discover portfolios on-chain, or maintain a database. Browser-side chain reads and wallet transactions are handled by the frontend/integration workstream. Smart contracts remain authoritative for collateral, share supply, migration, trading and redemption.

A2 uses USDT for financial settlement and assumes USD = USDT numerically. USDC is excluded from the asset universe. The assumption is a deliberate MVP simplification, not a guarantee of the peg. Do not implement conversion rates, stablecoin normalization, mandatory USDT/USD reference feeds or depeg detection. Actual swap proceeds are determined by executable routes, not by this assumption.

## 2. Confirmed conventions

| Area | Decision |
|---|---|
| Runtime | Python 3.12 |
| Dependency/build tooling | uv; modern Python packaging |
| Internal import names | `ind_*` only |
| Type checking | Strict mypy; `returns` mypy integration |
| Lint/format | Ruff |
| Tests | pytest; deterministic unit tests and opt-in live tests |
| Expected errors | `returns.result.Result[T, E]`, `Success`, `Failure` |
| Optional values | `returns.maybe.Maybe[T]`, `Some`, `Nothing` |
| Domain types | Frozen, slotted dataclasses; explicit identifiers and aliases |
| I/O | asyncio, aiohttp; one application event loop, no application-managed threads |
| Config | TOML for non-secrets, `.env` for secrets |
| Logging | Standard logging with Rich formatting and UTC timestamps; no metrics stack |
| Atlas transport | One WebSocket connection, subject to subscription limits; no outbound HTTP initialization |
| Asset universe | All verified WS-compatible common assets except USDC; exactly one feed per asset |
| Snapshot cadence | One second, locally generated |
| Persistent history | Completed UTC minute closes in Parquet; details deferred |
| Freshness / risk | No staleness gating, circuit breakers, age checks or out-of-order rejection in collector |
| Recovery | No reconnect, retry loop or HTTP fallback |
| Math | Separate pure `ind_math` package; detailed scope deferred |

No old project names, legacy prefixes or unrelated functionality in package names, imports, source comments, configuration or documentation. Recreate useful interfaces and conventions without importing another application's service code.

Use Python 3.12 type syntax (`type` aliases, PEP 695 generics when appropriate). Avoid `Any`, unchecked casts and untyped dictionaries in domain interfaces. Treat network JSON as `object` at the boundary; narrow its types explicitly. Use `Result` for expected parsing, configuration and I/O failures; `Maybe` for actual absence. Do not force these wrappers on total pure functions. Never unwrap unchecked. Pin the resolved compatible dependencies in `uv.lock`; the exact `returns` release is not fixed in this plan.

## 3. Architecture

```text
Static preprocessed asset registry
                |
       Atlas WebSocket
       one subscription
                |
       Typed wire decoder
                |
       Latest-price cache
                |
     All selected feeds received?
                |
       Immutable 1s snapshots
          /               \
  Live local API       UTC minute close
                           |
                        Parquet
```

One process and one asyncio event loop. WS reception, the snapshot timer and local HTTP request handling are coroutines. Price decoding and copying the cache are synchronous, bounded operations. No thread pool or `asyncio.to_thread` for application work. Do not start multiple HTTP server workers.

**Threading caveat:** aiohttp's default DNS resolution and PyArrow may use internal native/executor threads. No application-managed threads is the implementation baseline; whether zero OS-level worker threads is mandatory remains to be confirmed. If it is mandatory, verify the resolver and Parquet library behavior and select compatible implementations. Do not silently claim strict process-wide single-threaded execution.

### Removed from the previous plan

- Atlas HTTP pull initialization, periodic polling, fallback and standalone outbound HTTP transport package.
- Transport selection config, reconnect/backoff, freshness thresholds, signature/freshness validation in the Python collector, dynamic feed selection.
- USDC, USD/USDT conversion, CMC, risk engine, portfolio optimization.
- Backend blockchain indexer, transaction execution, wallet signing, portfolio discovery and speculative quote endpoints.
- Databases, Redis, queues, microservices, Grafana and distributed observability.

The Python collector's permissive acceptance policy does not change the verification and safety requirements of actual smart-contract transactions.

## 4. Static asset registry (`ind_assets`)

### Inputs

The supplied `common_assets.py` and `commonAssets.ts` are generated metadata for the Atlas/PancakeSwap common universe. The CSV exports provide flattened audit views, not a runtime data source.

| Catalog fact | Observed value |
|---|---:|
| Reference assets | 67 |
| Unique Atlas feeds | 73 |
| Pull-enabled feeds | 72 |
| Assets with alternative feeds | 6 |
| Reference chain | BSC mainnet (56) |
| Maximum candidate assets after USDC exclusion | 66 |
| Confirmed WS-accessible final universe | Not established |

The catalogs do not establish WebSocket entitlement, channel, initial delivery or publication cadence. Push heartbeats are not WS update intervals. Mainnet token addresses and symbol matching do not establish BSC testnet (97) collateral identity, backing or USDT swap routes. The integration workstream supplies executable testnet mappings separately.

### Offline selection

1. Exclude USDC and feeds that are not compatible with the selected WS channel/API key.
2. Select one feed per asset. Test ambiguous alternatives before selecting; do not average or switch feeds at runtime.
3. Verify each selected feed can actually deliver a typed observation over WS, including at startup.
4. Generate matching Python and TypeScript selected registries, preserving the original metadata and stable asset identity (`chain_id:lowercase_address`).
5. Ensure a unique feed-to-asset mapping for the selected universe, or explicitly resolve ambiguous mappings offline.

The runtime receives the final registry as a static generated module. It must not query a token list, search Atlas feeds or resolve identities dynamically. No API endpoint is needed solely to duplicate the supplied registry.

Known ambiguous choices from metadata (not final selection): ETH 632/852, XRP 634/717 (717 pull-disabled), MSFTB 943/1006, QQQB 947/1010, SPYB 956/1004, USDT 647/649. `(S)` likely denotes a single-feed push contract, but is not an established WS characteristic. USDT can be included as an ordinary common asset if desired and WS-compatible; it is not required for normalization.

### Proposed typed interfaces

```python
@dataclass(frozen=True, slots=True)
class AssetId:
    value: str

@dataclass(frozen=True, slots=True)
class FeedId:
    value: int

@dataclass(frozen=True, slots=True)
class SelectedAsset:
    asset_id: AssetId
    symbol: str
    feed_id: FeedId
    channel: FeedChannel
```

`FeedChannel` distinguishes documented public/private channels only if both are required by the final registry. The generator may use raw catalog dictionaries, but the server imports validated typed records. Constructors/factories and validation details are implemented with the domain types. No runtime economic-equivalence checks.

## 5. WebSocket transport (`ind_ws`) and Atlas (`ind_atlas`)

### Generic transport

Use `aiohttp.ClientSession.ws_connect`, asynchronous frame iteration and automatic responses to server ping frames. Keep the transport thin: establish a connection, send a typed text message, receive frames, report close/error and cleanly close the session on shutdown. No reconnect machinery, rate limiter, fallback client, task pool or exchange-specific logic.

Separate generic WS I/O from provider protocol parsing. `ind_atlas` owns authentication, subscription serialization, the Atlas wire envelope and binary decoder; `ind_ws` must not depend on Atlas. Keep these as small modules rather than constructing an unnecessary adapter hierarchy.

### Protocol (official SDK 1.0.2, live access unverified)

Endpoint: `wss://push.atlasoracle.io/ws`. Authentication is query parameter `apiKey`; construct it using URL/query encoding, not unescaped interpolation. Never log the authenticated URL or exception text that contains it.

Subscription example:

```json
{
  "method": "SUBSCRIPTION",
  "params": ["modix@auth.price@632", "modix@auth.price@634"]
}
```

Public channel: `modix@auth.price@{feed_id}`. Private channel: `modix@private.price@{feed_id}`. The official SDK permits unique, nonempty feed ID strings. Which channels this key can access remains unverified.

A data frame is JSON with `d` containing an object or a JSON-encoded string. Decode the string case a second time. The data object contains `payload`, `signature`, `magicMarker` as hex strings. Other frames (acknowledgments/control messages) are not price observations; do not mistake them for missing data or parse them into prices.

The packed format is designed for signed oracle delivery. It is not a JSON array of prices.

| Field | Bytes | Representation |
|---|---:|---|
| Feed ID | 4 | Unsigned big-endian |
| Price | 10 | Unsigned big-endian fixed-point, 18 decimals |
| Source timestamp | 6 | Unix seconds, unsigned big-endian |
| Count | 1 | Number of 20-byte records, at end of payload |
| Signature | 65 | Signature bytes |
| Magic marker | 2 | `0x7096` |

The combined wire representation is `[records][count][signature][marker]`; its size is `20*N + 68` bytes for the standalone price envelope. The 1-byte count permits at most 255 observations per signed message, not necessarily per subscription. Parse hex strings with optional `0x` prefixes, retain exact integer price precision and use `Decimal` without float conversion. `Decimal(raw_price).scaleb(-18)` is exact with adequate decimal context (an unsigned 80-bit value has at most 25 decimal digits). Preserve source timestamps as integers or typed UTC values.

The Python parser performs structural decoding only: envelope shape, field types, valid hex, record boundaries, count and marker needed to recognize the wire format. No source-age, economic plausibility, timestamp ordering, signature authenticity or price-range policy. Malformed frames produce a typed error; they do not mutate the cache. Structural decoding is not a claim of authenticated data validity.

```python
@dataclass(frozen=True, slots=True)
class PriceObservation:
    feed_id: FeedId
    price: Decimal
    source_timestamp: int


def decode_message(message: object) -> Result[tuple[PriceObservation, ...], AtlasDecodeError]:
    ...
```

The signature need not be persisted or exposed by this read-only server. Contract-level use of signed bytes, if needed, is a separate integration decision. Preserve the raw data in test fixtures only when useful and authorized. Do not introduce cryptographic libraries for the collector.

## 6. Cache initialization and updates (`ind_snapshot`)

The WS connection is the only source. No preliminary HTTP request.

| State | Meaning |
|---|---|
| `INITIALIZING` | At least one selected asset has never received an observation |
| `INITIALIZED` | Every selected asset has received at least one observation |

On startup, the cache is empty. Connect, subscribe to the complete selected registry and receive data. Maintain a `dict[AssetId, PriceObservation]` or equivalent internally, mapped from the selected feed IDs. The first structurally decoded observation for an asset initializes that entry. Unknown feed IDs have no corresponding entry and are ignored. When all selected entries exist, the initialization state becomes true permanently for the lifetime of the process.

Last received observation wins. Repeated and older source timestamps are accepted, and no entry expires. Assets that receive no messages retain the last observation. Do not compare timestamps to decide which price wins. Source timestamp is observation metadata, not a validity rule.

Process each decoded frame in one synchronous update section with no `await` inside it. Because all state mutation is on one event loop, locks, atomics and concurrent containers are not needed. A snapshot sees either the entire applied frame or the cache before that frame.

**Proposed disconnect semantics:** log the disconnect and stop the WS receiver; the server and timer continue with the last observations if already initialized. Do not reset the initialized state, reconnect, request prices over HTTP or introduce freshness-based gating. Before initialization, a disconnected receiver cannot complete initialization. Expose/log connection state as operational information only, not a price acceptance rule. A manual process restart is the recovery mechanism. This behavior is intentionally permissive and may serve indefinitely old observations; do not describe them as fresh market prices.

## 7. One-second snapshot scheduler (`ind_snapshot`)

The snapshot timer is independent of Atlas publication cadence. Receiving multiple WS messages in a second produces one sampled snapshot; receiving none produces a snapshot with unchanged entries. No periodic external requests.

```python
@dataclass(frozen=True, slots=True)
class AssetPrice:
    asset_id: AssetId
    feed_id: FeedId
    price: Decimal
    source_timestamp: int

@dataclass(frozen=True, slots=True)
class PriceSnapshot:
    snapshot_at: datetime
    prices: tuple[AssetPrice, ...]
```

Proposed API: `latest() -> Maybe[PriceSnapshot]`. Before initialization the result is `Nothing`; never fabricate zero prices. After initialization create a complete immutable tuple in stable registry order. The original source timestamps remain unchanged when prices are carried forward. The snapshot's UTC timestamp is distinct from each source timestamp.

Use one periodic asyncio coroutine with a monotonic deadline incremented by one second. Record actual UTC sample time, not an invented source time. If the event loop falls behind, skip missed timer ticks instead of emitting a burst of retroactive samples. No `await` while copying the cache. Schedule the first complete snapshot at the next timer tick after initialization.

```text
WS reader coroutine              Snapshot timer coroutine
-------------------              ------------------------
Receive message                  Wait until next deadline
Decode / apply batch             If cache initialized:
Await next message                 Freeze complete snapshot
                                   Publish latest snapshot
                                   Notify minute-close consumer
                                 Advance deadline
```

A 300-snapshot RAM ring buffer was suggested for the five-minute chart, but retention is part of deferred storage decisions. The minimum required implementation retains the latest complete snapshot. Do not make a history buffer mandatory until its interface and size are settled.

## 8. History (`ind_history`, `ind_fs`) — deferred detail

Confirmed: store the closing snapshot of each completed UTC minute in Parquet, with original exact prices and source timestamps. Keep 1-second snapshot generation separate from 60-second persistence. A minute close is the last complete snapshot sampled before the next UTC minute boundary. Do not assign observations after the boundary to the preceding minute. No fabricated history or offline backfill.

Proposed implementation to discuss in the storage workstream: one immutable Parquet file per minute for all selected assets, same-directory temporary file and atomic rename. Explicit Arrow schema (decimal128 with sufficient precision, UTC timestamps or documented integer seconds, asset/feed IDs). No per-tick file writes. `ind_fs` handles filesystem operations and typed errors; `ind_history` owns the Parquet schema and history reads. Do not add pandas, a database or compaction jobs for the MVP.

Open: minute file layout, retention, RAM ring buffer, query interface, restart semantics, handling synchronous disk I/O on the event loop and strict native thread policy. Measure read/write latency; do not hide blocking operations by introducing threads. Do not implement a full history design before these decisions are settled.

## 9. Local API (`ind_server`) — proposed contract

Use aiohttp for the server as well as WS client, avoiding a second networking framework. Bind to loopback by default. No user authentication or external deployment. HTTP here is **inbound frontend communication**, not an Atlas HTTP data source.

| Method | Proposed route | Meaning |
|---|---|---|
| GET | `/v1/snapshot` | Latest complete snapshot |
| GET | `/v1/history` | Historical price data; query parameters deferred |
| GET | `/v1/health` | Initialization and WS connection information, no circuit-breaker policy |

Frontend polling at 1 Hz is the proposed browser update mechanism. No browser WS/SSE requirement. Before initialization, return an explicit not-initialized response (proposed HTTP 503), not a partial snapshot with invented values. Once initialized, the snapshot API remains available even if the upstream is disconnected. Preserve source timestamps in the response. Exact prices serialize as decimal strings; never cast to float for transport.

Example proposed snapshot response (illustrative, not a live observation):

```json
{
  "snapshot_at": "2026-11-25T17:40:00Z",
  "prices": [
    {"asset_id": "56:0x...", "feed_id": 632, "price": "3100.123456789012345678", "source_timestamp": 1795628399}
  ]
}
```

No `/assets` duplication, portfolio indexer, analytics/quote endpoints or signer in the initial server. The API schema, CORS/local proxy arrangement, history query contract and frontend integration are to be confirmed. Do not return secrets, provider URLs containing secrets, or tracebacks in API responses.

## 10. Mathematics (`ind_math`) — deferred detail

Include a standalone pure math package. It has no I/O, network clients or dependency on the server. Use exact decimal/integer arithmetic where appropriate. The A2 scope to discuss later includes allocations, NAV, AUM, weights, returns and redemption estimates. Solidity is authoritative for execution and the frontend may independently display analytics. Exact rounding parity, historical state inputs and which analytics are exposed by the backend are not settled.

No USD/USDT conversion functions, USDC handling, CMC data, advanced risk calculations, rebalancing or optimization. No NumPy/SciPy unless a later workstream establishes a need. The server's initial data collection does not depend on `ind_math`.

## 11. Configuration and secrets (`ind_config`)

Configuration describes existing functionality, not speculative capabilities. Load TOML with Python 3.12 `tomllib`; use typed configuration objects and `Result`-based validation. The composition root is the only place that loads configuration, environment and constructs shared services. Packages receive configuration via typed arguments rather than reading environment variables. Proposed loader: `tomllib` plus small typed validators; use a standard dotenv reader if needed rather than implementing a shell parser. Exact dotenv dependency is pending.

### `.env.example`

```dotenv
IND_ATLAS_API_KEY=
```

The actual key belongs in an ignored local `.env` or environment. Never embed it in code, fixtures, TOML, logs, frontend bundle or committed files. Environment overrides for non-secret TOML settings are not needed. Missing key or invalid config is a startup error, not a runtime circuit breaker.

### `config.toml` (baseline)

```toml
[logger]
level = "INFO"
colors = true

[server]
host = "127.0.0.1"
port = 8000

[atlas.ws]
url = "wss://push.atlasoracle.io/ws"

[snapshot]
interval_seconds = 1

[history]
directory = "./data/history"
persist_interval_seconds = 60
```

UTC is the fixed timestamp convention, not a runtime timezone selector. The port, data directory, and log format defaults above are proposed. The history section expresses the confirmed minute-close requirement without committing to the detailed storage design. No `[atlas] transport`, `[atlas.http]`, normalization, retry, staleness, heartbeat or reconnection settings. If the provider mandates a client heartbeat, implement only the required protocol mechanism and its necessary configuration after verification.

## 12. Logging (`ind_logger`)

Use standard `logging` with Rich formatting, color when appropriate, UTC timestamps with milliseconds, aligned levels and component names. One initialization at the composition root; children use normal named loggers. Example:

```text
2026-11-25 17:40:00.012Z  INFO     assets    Loaded selected asset registry
2026-11-25 17:40:00.145Z  INFO     atlas     WebSocket connected
2026-11-25 17:40:01.002Z  INFO     snapshot  Cache initialized: all selected assets received
2026-11-25 17:41:00.004Z  DEBUG    history   Minute close persisted
2026-11-25 17:42:10.110Z  ERROR    atlas     WebSocket disconnected
```

Use DEBUG for per-message/snapshot diagnostic logging if needed. Default INFO should not emit a line for every feed update or snapshot. Log startup, initialization completion, failures and shutdown. No periodic logging thread, tracing, metrics exporter or remote logging. Redact the key and authenticated URL, including exception paths; avoid logging raw frames by default.

## 13. Proposed repository layout and dependencies

Use independent logical packages with `ind_*` import names; the uv workspace layout below is proposed, based on the previously agreed modular style. One service, not separate deployments. Each package exposes its public API explicitly and ships `py.typed` where appropriate.

```text
backend/
  .python-version            # 3.12
  pyproject.toml             # uv workspace, strict mypy, Ruff, pytest
  uv.lock
  .env.example
  .gitignore
  config.toml
  AGENTS.md
  packages/
    core/src/ind_core/
    config/src/ind_config/
    logger/src/ind_logger/
    assets/src/ind_assets/   # selected generated registry
    ws/src/ind_ws/
    atlas/src/ind_atlas/
    snapshot/src/ind_snapshot/
    fs/src/ind_fs/           # storage details deferred
    history/src/ind_history/ # storage details deferred
    math/src/ind_math/       # math details deferred
  services/
    server/src/ind_server/
      __init__.py
      main.py
      app.py
      routes.py
      py.typed
  tests/                     # integration tests; package unit tests alongside packages
```

| Dependency | Use |
|---|---|
| `returns` | Result, Maybe, strict typing |
| `aiohttp` | Atlas WS client and local HTTP server |
| `rich` | Logging formatting |
| `pyarrow` | Parquet, when history workstream is implemented |
| `mypy`, `ruff`, `pytest` | Development/test tooling |
| dotenv loader / async test helper | Only if needed; not yet selected |

Use standard library asyncio, dataclasses, decimal, datetime, logging, tomllib, pathlib, json. No `httpx`, `websockets`, FastAPI, Uvicorn, web3.py, CMC SDK, NumPy or SciPy in the initial service. Declare dependencies in the packages that actually consume them. Do not invent dependencies on empty deferred modules.

Dependency direction (arrow means depends on):

```text
ind_server -> ind_config, ind_logger, ind_assets, ind_atlas, ind_snapshot
ind_atlas  -> ind_ws, ind_core
ind_assets -> ind_core
ind_snapshot -> ind_core
ind_history -> ind_snapshot, ind_fs   (deferred)
ind_math -> ind_core                 (deferred)
```

The composition root wires the WS receiver to the cache. `ind_atlas` need not import the server, snapshot scheduler or registry generator. Use dependency injection where it permits deterministic tests, without speculative class hierarchies.

## 14. Independent implementation tasks

Each task is independently reviewable and testable using typed fixtures or fake I/O. Integration does not require live Atlas access until the provider verification gate.

| ID | Task | Dependencies | Acceptance |
|---|---|---|---|
| S00 | Python workspace/tooling | None | uv sync, strict mypy, Ruff and pytest pass on Python 3.12 |
| S01 | Core value types | S00 | Typed identifiers, Result/Maybe conventions, immutable records |
| S02 | Config and secrets | S00–01 | TOML loads; typed errors for wrong/missing fields; secrets never logged |
| S03 | Logger | S00 | UTC ms timestamps, Rich formatting, no secret leakage |
| S04 | Asset selection/generator | S01 | Matching static Python/TS registry; one verified feed per asset; no USDC |
| S05 | Generic WS client | S00–01 | Async fake-server connect/send/receive/close; no reconnect or thread pool |
| S06 | Atlas protocol decoder | S01 | Typed subscription/envelope/packed records, exact decimal decoding; fixture tests |
| S07 | Atlas WS collector | S05–06 | One subscription, stream observations; no Atlas HTTP calls |
| S08 | Latest price cache | S01 | Initialize only after all assets received; last-arrival-wins; immutable copies |
| S09 | 1s snapshot scheduler | S08 | Independent timer, deterministic fake clock tests, no fabricated catch-up ticks |
| S10 | Local aiohttp server | S02–03, S08–09 | Snapshot/readiness API, exact decimal strings, no frontend secrets |
| S11 | Live Atlas probe | S05–07 | Confirm entitlement, complete initial coverage, frame shapes, limits/cadence |
| S12 | Composition root | S02–04, S07–10 | Single process; shutdown closes session/tasks; startup and local demo work |
| S13 | Parquet and filesystem | S09 | Deferred design; minute-close persistence and history read tests |
| S14 | Math | S01 | Deferred design; independent pure-function tests |
| S15 | Frontend integration | S10, S12 | Generated registry parity and snapshot API integration; history when ready |

S04 can first implement the generator/interface using explicitly labeled fixtures; final production/demo selection depends on S11. S05/S06/S08/S09 can proceed independently. Do not couple the live access gate to unit tests.

### Required unit/integration cases

- Config loads from TOML and a locally supplied secret; wrong types and missing required fields produce typed failures. No credential or authenticated URL in logs, including transport errors.
- Public/private subscription serialization and unique registry feed mapping. WS text and binary JSON frame handling as observed/documented; nested `d` JSON; non-price frames; malformed type/hex/length/count/marker errors; exact 18-decimal representation.
- Empty/partial cache has no complete snapshot. Last missing asset completes initialization. Multiple messages update correct entries. Older source timestamps and repeated values overwrite or retain values according to last-arrival-wins. Unknown IDs do not expand the selected universe.
- One-second timer works independently of messages. A previous snapshot cannot be changed by subsequent updates. Missing timer ticks do not generate fake historical observations.
- WS closure does not reconnect, call HTTP or invalidate the initialized cache. Verify the proposed post-disconnect behavior explicitly before adopting it.
- Local server distinguishes not initialized from complete snapshot; JSON prices are strings and source timestamps preserved. Clean shutdown cancels tasks and closes resources.
- Deferred storage: exact UTC minute boundary behavior, no artificial offline records, atomic writes and readback; deferred math: precision, edge cases and any agreed contract-rounding parity.

## 15. External verification and remaining questions

### Atlas API — blockers, not architecture choices

| ID | Question | Status |
|---|---|---|
| B11/B12 | One feed per asset; all WS-compatible common assets | Policy confirmed; actual selected registry unverified |
| B42 | Maximum subscriptions per connection, connection/key limits | No verified published limit |
| B43 | Meaning of `(S)` | Single-feed push contract is an inference; no need to block WS testing on naming |
| B47 | Mandatory client heartbeat / idle behavior | Verify; SDK supports no reconnect and no configured ping loop in that mode |
| B48 | WS publication frequency and behavior for inactive assets | Not specified sufficiently in inspected SDK; measure actual behavior |
| B50 | Public/private channel and entitlement for each selected feed | Verify against the key |
| B51 | Does subscription deliver an initial observation for every selected feed? | Critical startup gate; not verified |
| B52 | Subscription acknowledgment, rejection and provider error frames | Capture actual shapes |

HTTP request-rate and batch-size questions are removed from the server's scope because it never calls Atlas HTTP. WS quotas remain relevant. The one-second local timer generates no provider traffic. The 255-record binary count is not a subscription limit.

Live verification must use the locally supplied credential, redact it from output, and test the actual Atlas endpoint rather than assuming the SDK demonstrates account access. Existing probe and catalog exports are diagnostic inputs. Prior live calls were blocked by DNS in the assistant environment; no WS access or initial delivery has been demonstrated. Extend/use the probe in WS-only mode (the prior probe makes HTTP requests by default). Test small subscriptions, then the full selected universe if permitted, and record first-delivery coverage, message types and observed update cadence. Do not aggressively probe rate limits; ask Atlas for quotas.

If initial delivery is not guaranteed, a WS-only server may remain in `INITIALIZING` indefinitely. Do not silently restore HTTP initialization or remove inactive assets at runtime. Bring the finding back for a design decision or refine the offline selected registry based on actual supported feeds.

### Deferred internal decisions

| Group | Pending decision |
|---|---|
| B18/B34 | Parquet layout, RAM buffer size and retention, read interface |
| B25/B26/B29 | Math responsibilities, exact Solidity parity, whether analytics belong in API |
| B33 | API schema/type generation and frontend polling contract |
| B37 | No application-managed threads vs absolutely no internal native/executor threads |
| Config | Final dotenv loading dependency and typed validation implementation |
| Lifecycle | Proposed post-disconnect behavior (continue last-value snapshots) and readiness response details |
| Contracts/integration | Testnet token identity, executable USDT routes, optional OpenFour authorization signer outside this initial server |

## 16. References and supplied inputs

- Generated `common_assets.py` and `commonAssets.ts` (2026-11-25T16:06:27+00:00); `indexfi_common_assets_full.csv` and `indexfi_common_assets_summary.csv` for metadata review.
- Atlas official SDK: https://github.com/oracle-atlas/pull-oracle-consumer-sdk/blob/main/src/transport/ws.ts
- Atlas binary parser: https://github.com/oracle-atlas/pull-oracle-consumer-sdk/blob/main/src/parser.ts
- Atlas SDK configuration: https://github.com/oracle-atlas/pull-oracle-consumer-sdk/blob/main/src/types.ts
- Atlas docs: https://docs.atlasoracle.io/
- Existing diagnostic utility: `indexfi_atlas_probe.zip` (requires adapting its default HTTP-first behavior to WS-only testing).
- OpenFour developer guide: https://github.com/four-meme-community/openfour-docs/blob/main/docs/developer-guide.md

This plan does not claim that the server is implemented or that Atlas access, rate limits, feed mappings, testnet collateral, A2 contract compatibility or sponsor bounty qualification have been verified.
