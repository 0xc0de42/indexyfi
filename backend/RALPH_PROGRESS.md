# Phase I — implementation ledger

This ledger records the final state of the bounded Phase I implementation loop.
Earlier environment and DNS blockers were resolved on 2026-11-25.

## Verification

| Area | Result |
|---|---|
| Runtime and dependencies | CPython 3.12.12; locked `uv` sync passed |
| Static quality | Ruff lint/format and strict mypy passed for all ten packages |
| Automated tests | 27 passed, 0 skipped |
| Entrypoint | `python -m ind_server --help` passed |
| Atlas verification | 70 feeds observed; 66 unique assets selected |
| Complete subscription | All 66 selected assets initialized in about two seconds |
| HTTP and persistence | `/snapshot`, `/history`, and 66-row minute Parquet verified |

The live result applies to the tested API key and observation window. It does
not establish an exact provider-wide subscription quota, guarantee future
delivery, or authenticate Atlas signatures in the Python collector.

## Phase I task status

Tasks I.01–I.24 are implemented and verified for the Phase I hackathon scope.
The deliberate product constraints remain: no reconnect or HTTP fallback, no
freshness/economic-validity policy, cached values survive disconnection, and
signature authenticity is not checked by this read-only collector.

## Operational notes

- The service uses one asyncio event loop and no application-managed threads.
- PyArrow writes one 66-row file per completed UTC minute; the current minute
  is intentionally not flushed during shutdown.
- History reads are synchronous. Normal short queries are small, but the API
  should bound requested time ranges before any non-local deployment.
- Provider behavior should be reverified if the API key, feed catalog, channel
  contract, or selected registry changes.

## CMC integration loop — 2026-11-26

| Area | Result |
|---|---|
| Approved identities | 66 mappings: 33 exact tokens and 33 underlying references |
| Persisted daily history | 66/66 series; 1,956 observations; 2026-10-27 through 2026-11-25 |
| Local HTTP validation | Three `/v1/cmc/*` endpoints served all mappings and histories |
| Live Basic-key validation | 66/66 latest quotes; one credit; historical batch 20 credits |
| Static quality | Ruff lint/format and strict mypy passed, including `ind_cmc` |
| Automated tests | 40 passed, 0 skipped |

The bounded loop corrected the CMC daily boundary so a fresh initialization requests 30 completed
UTC observations. Established assets now have all 30 days locally; newly listed ANTB has the six
observations CMC returned. Provider failures preserve cached data and older valid quote arrivals
replace newer ones as required. No historical gap scan or repair policy was introduced.
