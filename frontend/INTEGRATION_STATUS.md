# IndexFi Phase II — frontend integration ledger

Loop: read this file → pick the first open item → implement → run `pnpm test` +
`pnpm typecheck` → update this file. Backend is read-only in this phase.

Decisions (user, 2026-11-25): funding currency USDT; demo mode removed;
`/assets` gets live prices, Explore keeps fixture portfolios (labelled).
Transport: same-origin Next.js proxy `/backend/* → PYTHON_API_URL` (avoids the
`localhost` vs `127.0.0.1` CORS mismatch); override with `NEXT_PUBLIC_INDEXFI_API_URL`.

| # | Item | Status |
|---|---|---|
| 1 | Audit FE routes, pricing, registry, fixtures, scripts | done |
| 2 | Registry generator from backend `selected.json` + metadata; parity test | done |
| 3 | Typed HTTP client (`/snapshot`, `/history`) with runtime decoding + mock-server tests | done |
| 4 | Central 1 Hz poller/store; remove WebSocket transport and demo mode | done |
| 5 | History loading/merging + charts | done |
| 6 | Pages: Assets, Explore, Create (USDT), Portfolio, Investments, Shell | done |
| 7 | Full checks: test, typecheck, build | done |
| 8 | Live integration against real backend + browser check | done |
| 9 | Integration report and required fixes | done |
| 10 | Start-up loader that warms registry, prices, logos and 5 min history | done |

## Integration report (2026-11-25)

Checks run (all actual results):

| Check | Result |
|---|---|
| `pnpm test` | 51 passed, 9 live tests skipped (6 files) |
| `pnpm typecheck` (strict tsc) | pass |
| `pnpm build` (Next 16.4.6) | pass |
| `pnpm registry:check` | up to date, 66 assets |
| lint / format | not available: no lint or format tooling in the workspace |
| `test:live` vs running backend, direct + via Next proxy | 16/16 passed |
| Headless Chrome on production build (`next start :3001`) | pass, see below |

Browser check: `/assets` showed 66/66 assets priced. Over 10.8 s it issued 11 `/backend/snapshot`
requests (one poller, max 1 in flight), no WebSockets, no Atlas requests and no
console errors. One filtered `/history` request is issued per asset or window change. Charts
show stored minute closes followed by live samples ("40 minute closes · 3 live samples").
Client-side navigation keeps the single poller. Refresh works. Phone width (390 px) has no
horizontal overflow.

Verified backend facts: `/snapshot` returns exactly the 66 registry assets with matching
feeds; `/history` filters by repeated `asset_id`, is chronological, empty for unknown
IDs, accepts exactly 24 h, and answers 400 for `start >= end` and naive timestamps.

### Required fixes / follow-ups

Backend:
1. `/history` does not enforce the 24 h limit (25 h → HTTP 200). `HistoryStore.read` walks
   every minute synchronously on the event loop, so a huge range blocks the server. Add
   `end - start > timedelta(hours=24)` → 400 `invalid_time_range` in `parse_history_query`.
   The frontend already blocks such ranges.
2. CORS allows only `http://localhost:3000`, but `next dev` binds `127.0.0.1:3000` (that
   origin gets no `Access-Control-Allow-Origin`). Not blocking, since the FE uses the
   same-origin proxy. Needed only for direct calls via `NEXT_PUBLIC_INDEXFI_API_URL`.
3. After an Atlas disconnect `/snapshot` keeps returning 200 with frozen prices, and the FE
   cannot tell (by design it adds no staleness logic). Consider reconnecting or exposing a
   factual upstream status.
4. `README.md`, `RALPH_PROGRESS.md` and `REFACTOR_REPORT.md` are stale versus `TEST_RESULTS.txt`.

Frontend / repo:
5. `backend/` is untracked. The registry generator and parity test read `../../../backend/registry`,
   so a checkout without it fails `pnpm test`. Commit `backend/`.
6. The root `README.md` still documents the old WebSocket protocol and says `backend/` is reserved.
   The ignored `dump/asset-sync` pipeline still targets the deleted `data/commonAssets.ts`.
7. The `@x402/*` dependencies are unused; remove them.
8. Categories come from Atlas feed tags only (63 Crypto, 3 LST). Richer categories need curated metadata.
9. Deferred to Phase III: portfolio NAV history, holdings and current weights, wallet balances,
   launch, trading and chain-97 collateral. Portfolio metrics remain labelled fixtures.

## Start-up loader (item 10)

`components/app-loader.tsx` is rendered in the server HTML, so it shows on first paint while the
app renders underneath, made `inert`. It warms the first complete `/snapshot` (via the shared poller),
all 66 logos, and one 5-minute `/history` request for all assets (`lib/history-cache.ts`). Charts with
windows of 5 minutes or less reuse that request within the same UTC minute instead of fetching.
Unlike the per-chart requests, this one deliberate warm-up is not filtered by `asset_id`.
The loader dismisses when prices are complete and logos and history have settled, after at least 0.9 s.
Skip appears after 4 s, and "Continue anyway" appears on failure. It is shown once per page load.

Verified in headless Chrome: healthy API → dismissed after about 1.8 s, with a single history request
serving the first chart and later portfolio charts. API blocked → failure states plus Continue;
the app recovers by itself when the API returns. No hydration errors.

Note: the `/backend` rewrite target (`PYTHON_API_URL`) is fixed at `next build` time. Changing it
for `next start` alone has no effect, so rebuild after changing it.
