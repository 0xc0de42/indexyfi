# V3 validation — November 26 API alignment

**18 passing local Flap tests.** All 348 original archive files are byte-for-byte unchanged. Compiled using solc 0.8.24, viaIR, optimizer 200, Paris. Full selected compilation generated 17 artifacts; the new signed fixture was compiled separately using the same settings. The complete Flap suite was run against the generated artifacts. Current OpenFour contracts compiled for ABI comparison only; no upstream OpenFour regression suite was run.

| Contract | Runtime bytes | Initcode bytes |
|---|---:|---:|
| IndexFiFlapFactory | 23469 | 32358 |
| IndexFiFlapLauncher | 6174 | 7289 |
| IndexFiFlapVault | 24270 | 24478 |
| IndexFiFlapVaultFactory | 5555 | 5937 |

All fit EIP-170 and EIP-3860; vault has 306 runtime bytes of headroom. Tests cover current shared ABI and price wrappers versus OpenFour ABI, request IDs and events, successful launch and locked initial LP, native factory binding, inventory recycling, secondary tax model, 18-decimal USD, atomic rollback, authorization, per-leg redemption, in-kind return arrays/events, price deviation, simulated quote nonpersistence, valid/invalid/stale signed fixture prices, malformed arrays and price update rollback. No actual Atlas wire verification: signed fixture is intentionally a different format. No actual Portal, Dock, BSC testnet, or public deployment validation performed. `AtlasSignedOracle` is absent in the supplied archive. Salt locking/fee handling and anti-scam integration remain release blockers. No claim of audited or production-ready code. Prior V2 security-hardening issues are not addressed by this API alignment revision.
