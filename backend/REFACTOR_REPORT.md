# Phase I — type-safety refactor

This increment updates the existing Phase I source without changing the product
architecture, API routes, price encoding, snapshot cadence, retention, or
currency assumptions. No Phase II/III or mathematics work.

## Changes

| Area | Change |
|---|---|
| ind_ws | Explicit WebSocketErrorCode/WebSocketError; connect/send/receive/close return Result; normal closure is Success(Nothing). |
| ind_atlas | WireError is a frozen record, not an exception; decoder/subscription return Result; CollectorError returned to composition root. |
| ind_assets | Checked JSON narrowing and typed candidate/selected records; explicit RegistryErrorCode. |
| ind_snapshot | Result factory rejects invalid registry construction; latest cache remains Maybe. |
| ind_fs | Maybe temporary path; atomic writer accepts typed Result and preserves underlying error. |
| ind_history | Maybe pending minute; typed Parquet row decoding without casts; explicit storage codes. |
| ind_config | Nested frozen config, secrets hidden in repr; both entrypoints use one loader. |
| ind_server | Typed history query and API errors; TypedDict serialization; Result-based startup; explicit error handling. |
| quality | Explicit exports, strict mypy plus disallow_any_explicit; AST regression check; tests for errors, config, timer and storage. |

## Boundaries and decisions

- Native None is legitimate for unit values and library boundary inspection;
  no production optional union with None is used for domain state.
- Native exceptions are caught where expected, not globally suppressed.
  Cancellation and unexpected programming faults propagate.
- Arrow and aiohttp are third-party boundaries; dynamic return values are
  narrowed to object before use in domain records. Arrow remains untyped, with
  its imports explicitly isolated; strict type checking passes around that
  boundary.
- Verification CLI flags are operational inputs; provider URL and paths are
  TOML configuration. Verification emits a finalized typed Python registry for
  the backend and a JSON handoff used to generate the frontend's finalized
  typed TypeScript registry. Runtime code imports the language-native modules.
- `assets.candidates` was added to TOML; no additional secret is required.
- A close after initialization does not invalidate cached observations.
  No HTTP recovery, price freshness, timestamp ordering or circuit breaker.
- Signature length, marker and payload structure are decoding checks, not
  signature authentication or economic validity.

## Acceptance status

Verified on 2026-11-25 with CPython 3.12.12 and the locked production
dependencies. `backend/check.sh` passed dependency sync, Ruff lint and format,
strict mypy for all ten packages, 27 tests with no skips, and the module
entrypoint.

Live Atlas verification observed 70 candidate feeds and produced a registry of
66 unique assets. The combined subscription initialized all 66 prices; the
snapshot and history endpoints and 66-row minute Parquet persistence were then
exercised successfully. See `TEST_RESULTS.txt` for the concise evidence record.
