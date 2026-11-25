# IndexFi — Implementation plan

Status: Phase I implemented and verified on 2026-11-25; see
`RALPH_PROGRESS.md` and `TEST_RESULTS.txt` for evidence and caveats. This
roadmap defines execution order for the existing V3 workstream specifications.
It does not replace their detailed requirements.

## Roadmap

| Phase | Focus | Deliverable | Tasks |
|---|---|---|---:|
| I | Server skeleton, Atlas integration, endpoint exposure | Working local market-data server | 24 |
| II | Frontend integration | Frontend consuming live prices and history | 13 |
| III | Smart contracts and blockchain integration | Functional A2 Redeemable Basket | 16 |
| Final | Mathematics and numerical consistency | Financial calculations where required | Deferred |
| Total | | | 53 |

Implement and test each task independently. Introduce packages and dependencies only when consumed. Keep contract-dependent frontend functionality explicitly labeled as fixtures until deployed contracts are integrated. Mathematics is deferred until the actual contract interfaces and rounding requirements are established.

## Phase I — Server and Atlas integration

### Confirmed requirements

- Python 3.12, uv workspace, `uv_build`, strict mypy, Ruff, pytest, `src/` layouts, `py.typed`, `ind_*` package names.
- `returns.result.Result` and `returns.maybe.Maybe`; immutable domain records; PEP 695 type aliases; typed boundary parsers.
- Single asyncio event loop, no application-managed threads; disable optional library parallelism wherever feasible. Strict process-level thread guarantees remain unverified.
- `aiohttp` for WebSocket client and local HTTP server. Atlas WebSocket only, including initialization; no HTTP initialization or fallback, no automatic reconnect.
- Preprocessed registry, exactly one feed per asset, all verified WS-compatible common assets excluding USDC. Python and TypeScript mappings must agree.
- Last received observation wins. Once all selected assets have supplied a price, the cache stays initialized. No freshness, ordering, price validity or circuit-breaker policies beyond structural/type decoding. Keep source timestamps. After disconnection, continue using cached values if initialized; otherwise remain uninitialized. Log disconnects.
- Generate immutable snapshots every second after complete initialization. Retain latest snapshot only by default. Persist the last snapshot of each completed UTC minute as one Parquet file containing all assets. Do not fabricate missing history. Unlimited MVP retention; read existing history on demand. Log persistence failures and continue.
- `GET /snapshot` and `GET /history`; no `/v1` prefix or health endpoint initially. Decimal strings in JSON, HTTP 503 before complete initialization, time-range and asset filters for history, local frontend CORS only.
- TOML configuration and `.env` secrets only; typed validation using `tomllib` and `Result`, `python-dotenv`, explicit `--config` default `config.toml`. UTC timestamped formatted logging only; no telemetry stack.
- USD/USDT parity is an MVP assumption. No currency normalization. USDT settlement. No mathematics package dependency, CMC, DB, transaction signer or blockchain indexer in Phase I.

### Tasks

| ID | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|
| I.01 | Project skeleton | None | Workspace builds; lint, strict typing, smoke test and entrypoint pass | Verified |
| I.02 | Core types | I.01 | Typed identifiers, immutable records, Result/Maybe conventions | Verified |
| I.03 | Configuration | I.01 | Typed TOML loading and `.env` secrets; no secret logging | Verified |
| I.04 | Logger | I.01 | Formatted UTC timestamps, colors and component names | Verified |
| I.05 | Generic WebSocket client | I.01–02 | Connect, send, receive and close using aiohttp; local fake server tests | Verified |
| I.06 | Atlas protocol | I.02 | Subscription serialization and exact binary decoding; fixture tests | Verified |
| I.07 | Atlas collector | I.05–06 | Receive typed price observations; handle connection closure without recovery | Verified |
| I.08 | Live Atlas verification | I.07 | Establish accessible feeds, combined delivery and actual wire schema | Verified for selected registry |
| I.09 | Asset registry | I.02, I.08 | One verified selected feed per asset; matching Python/TS registries | Verified: 66 assets |
| I.10 | Latest-price cache | I.02 | Complete initialization, last-arrival-wins updates, no expiration | Verified |
| I.11 | Snapshot timer | I.10 | Immutable snapshots every second after initialization | Verified |
| I.12 | Snapshot endpoint | I.03–04, I.11 | Complete snapshots via aiohttp; 503 during initialization | Verified |
| I.13 | Composition root | I.03–12 | Working standalone server | Verified |
| I.14 | Historical persistence | I.11 | Atomic minute-close Parquet files; preserve gaps | Verified |
| I.15 | History endpoint | I.14 | Query persisted historical prices by asset and time | Verified |
| I.16 | Integration tests | I.13–15 | Complete WS-to-API-to-Parquet pipeline | Verified |
| I.17 | Typed package errors | I.02–16 | Structured error codes and typed failures | Verified |
| I.18 | Result-based fallible interfaces | I.17 | WS, decoder, cache, API, storage and CLI boundaries | Verified |
| I.19 | Maybe-based optional state | I.18 | No native optional domain state | Verified |
| I.20 | Nested TOML config | I.03 | Immutable typed config sections | Verified |
| I.21 | Shared configuration loader | I.20 | Both server and verifier use ind_config | Verified |
| I.22 | Typed boundary parsing | I.18–21 | No unchecked casts or explicit Any | Verified |
| I.23 | Explicit package public interfaces | I.22 | Declared public module exports | Verified |
| I.24 | Complete quality gate | I.17–23 | Python 3.12 lock, Ruff, strict mypy, all tests | Verified: 27 passed |

### Execution order

```text
I.01 Skeleton
  ├── I.02 Core types
  │     ├── I.05 WebSocket ───────┐
  │     ├── I.06 Atlas protocol ─┴── I.07 Collector
  │     │                              └── I.08 Live verification
  │     │                                    └── I.09 Registry
  │     └── I.10 Cache ── I.11 Timer ── I.12 Snapshot API
  ├── I.03 Configuration ────────────────────┘
  └── I.04 Logger ───────────────────────────┘
             I.13 Composition root (join all required branches)
                          │
                  Working live server
                          │
                  I.14 Persistence
                          │
                  I.15 History API
                          │
                  I.16 Integration tests
```

Expose the first working snapshot endpoint before persistence. Work on fixture-based modules can proceed while live Atlas verification is pending. Do not claim live integration success until real authenticated observations have been received and decoded.

### External Atlas gate (I.08)

Verify public/private subscription channels, per-key entitlements, maximum feeds per connection, ping requirements, acknowledgment/error schemas, real signed payload formatting and initial observation delivery for every selected feed. Publication frequency need not equal the local 1 Hz snapshot frequency. Without initial delivery, WS-only initialization may remain incomplete; do not silently introduce an HTTP fallback. Live verification succeeded on 2026-11-25 for the selected registry, but did not establish an exact maximum provider quota or a future-delivery guarantee. Never include the API key in source, fixtures, logs or reports.

## Phase II — Frontend integration

Reuse the existing frontend skeleton. The snapshot API can serve as an early integration target before history is ready.

| ID | Task | Deliverable | Status |
|---|---|---|---|
| II.01 | Frontend skeleton and tooling | Next.js, TypeScript, shadcn, IndexFi branding | Pending |
| II.02 | UI domain types | Typed assets, portfolios, prices and API responses | Pending |
| II.03 | Asset registry integration | Generated TypeScript asset catalog | Pending |
| II.04 | Server API client | Snapshot and history requests | Pending |
| II.05 | Live price integration | One-second frontend polling | Pending |
| II.06 | Historical charts | Five-minute default chart using available history | Pending |
| II.07 | Explore page | Asset and portfolio discovery interface | Pending |
| II.08 | Portfolio details | Composition, prices, charts and trading interface | Pending |
| II.09 | Create portfolio | Asset selection, allocations and funding wizard | Pending |
| II.10 | My Investments | Positions, created portfolios and activity | Pending |
| II.11 | Wallet integration | RainbowKit, Wagmi and Viem | Pending |
| II.12 | Transaction adapter interfaces | Typed creation, trading and redemption interfaces | Pending |
| II.13 | Integration tests | Complete frontend connected to the server | Pending |

Phase exit: working interface consuming real Atlas data; contract-dependent functionality clearly identified as fixtures. Latest-only RAM storage does not provide a persistent second-resolution chart; use available minute closes and live observations without fabricating data.

## Phase III — Smart contracts and blockchain integration

| ID | Task | Deliverable | Status |
|---|---|---|---|
| III.01 | OpenFour skeleton | Official Hardhat starter and passing baseline tests | Pending |
| III.02 | Module architecture | Determine actual Vault, Curve, Trade and Migrate interfaces | Pending |
| III.03 | Testnet asset registry | Verified collateral tokens and USDT routes | Pending |
| III.04 | PancakeSwap integration | Constituent acquisition and liquidation | Pending |
| III.05 | Basket Vault | Multi-asset collateral custody | Pending |
| III.06 | Basket token | Fixed initial share supply | Pending |
| III.07 | Portfolio creation | Atomic weighted acquisition and issuance | Pending |
| III.08 | Oracle integration | Contract-compatible reference pricing | Pending |
| III.09 | Trading | OpenFour buy/sell functionality | Pending |
| III.10 | Fee accounting | Creator and protocol fees | Pending |
| III.11 | Redemption | Proportional burn and liquidation into USDT | Pending |
| III.12 | Migration | PancakeSwap liquidity migration | Pending |
| III.13 | Contract testing | Accounting, permissions, atomicity and failure cases | Pending |
| III.14 | Deployment | BSC Testnet contracts and generated ABIs | Pending |
| III.15 | Frontend contract adapters | Replace fixture transactions with real transactions | Pending |
| III.16 | End-to-end testing | Create, buy, sell, redeem and migrate | Pending |

Phase exit: functional A2 Redeemable Basket on BSC Testnet, with verified token routes, actual custody, USDT settlement and redemption. Contract security checks remain separate from the intentionally minimal Python collector. Mainnet asset metadata does not establish executable testnet collateral. OpenFour module compatibility, fees, migration and redemption mechanics remain to be resolved in the corresponding tasks.

## Final — Mathematics

Defer `ind_math` until after contract interfaces are established. Determine actual requirements for NAV, AUM, allocations, weights, returns, redemption previews and Solidity rounding parity. Implement pure, typed functions only where needed. No currency conversion under the MVP USD/USDT parity assumption. No risk or strategy optimization in A2.

---

# Immediate task — I.01: Project skeleton

## Objective

Establish development tooling, packaging conventions and repository structure without business logic. This task is independently testable and requires no Atlas credentials or external service at runtime.

## Target structure

```text
indexfi/
├── AGENTS.md
├── README.md
├── .gitignore
└── backend/
    ├── .python-version
    ├── .env.example
    ├── pyproject.toml
    ├── uv.lock
    ├── packages/
    ├── services/
    │   └── server/
    │       ├── pyproject.toml
    │       ├── src/
    │       │   └── ind_server/
    │       │       ├── __init__.py
    │       │       ├── __main__.py
    │       │       └── py.typed
    │       └── tests/
    │           └── test_smoke.py
    └── tests/
```

Create additional packages only during their tasks. Preserve unrelated existing repository content. Empty directories may require a tracked placeholder.

## Conventions

| Component | Configuration |
|---|---|
| Python | 3.12 |
| Packaging | uv workspace |
| Build backend | `uv_build` |
| Typing | Strict mypy |
| Linting and formatting | Ruff |
| Testing | pytest |
| Package layout | `src/` |
| Internal package prefix | `ind_` |
| Type aliases | PEP 695 |
| Public interfaces | Explicit exports |
| Version locking | `uv.lock` |
| Secrets | Ignore `.env`; empty/example values only in `.env.example` |
| Application configuration | TOML, implemented in I.03 |

The entrypoint should only demonstrate that the service is installed and executable. No networking or business logic.

## Packages by the end of Phase I

| Package | Introduced in | Responsibility |
|---|---|---|
| `ind_core` | I.02 | Common domain types |
| `ind_config` | I.03 | Configuration and secrets |
| `ind_logger` | I.04 | Logging |
| `ind_ws` | I.05 | WebSocket transport |
| `ind_atlas` | I.06–07 | Atlas protocol and collector |
| `ind_assets` | I.09 | Static asset registry |
| `ind_snapshot` | I.10–11 | Cache and snapshot generation |
| `ind_server` | I.01, I.12–13 | Application entrypoint and API |
| `ind_fs` | I.14 | Atomic filesystem operations |
| `ind_history` | I.14–15 | Parquet persistence and retrieval |

## Dependency introduction

| Dependency | Task |
|---|---|
| `uv_build`, `mypy`, `ruff`, `pytest` | I.01 |
| `returns` and mypy plugin | I.02 |
| `python-dotenv` | I.03 |
| `rich` | I.04 |
| `aiohttp` | I.05 |
| `pyarrow` | I.14 |

Generate the actual lockfile during implementation. No unnecessary runtime dependencies in I.01.

## Acceptance criteria

From `backend/`, all commands must pass:

```bash
uv sync --all-packages --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy -p ind_server
uv run pytest
uv run python -m ind_server
```

The smoke test must verify importability and successful entrypoint execution. The workspace must contain no secrets or obsolete project prefixes.

## Out of scope

Atlas integration, configuration parsing, logger implementation, API endpoints, mathematics, Parquet, frontend and smart contracts.

## Definition of done

Skeleton committed or ready for review, dependency lock generated, all acceptance commands verified. Record actual test results and any blockers rather than marking tasks complete on the basis of the plan alone.

## Progress

| Phase | Total tasks | Completed |
|---|---:|---:|
| I | 24 | 24 |
| II | 13 | 0 |
| III | 16 | 0 |
| Final | Deferred | 0 |
| Total | 53 | 24 |

Phase I quality and live-integration checks completed on 2026-11-25. See
`TEST_RESULTS.txt` and `RALPH_PROGRESS.md` for evidence and operational caveats.
