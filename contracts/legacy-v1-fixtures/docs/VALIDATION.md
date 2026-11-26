# Validation evidence — 2026-11-26

- Source: official OpenFour startup, commit `079a45e9c3358c9f357c84f336c7d915c9f0e9fc`.
- Preserved upstream package-lock.json and build settings.
- `npm ci --ignore-scripts`: installed successfully.
- `npm run compile`: 38 Solidity files, solc 0.8.24, Paris target, optimizer 200, viaIR.
- `contracts/openfour npm test`: 17 passing (13 upstream/preset-engine plus 4 IndexFi lifecycle tests).
- `backend ./check.sh`: Ruff, formatting, mypy and CLI checks pass; 27 tests pass.
- `frontend/apps/web npm test`: 88 pass; 9 opt-in live tests skip. TypeScript and the Next production build pass.
- `integration npm test`: browser-driven create, discovery, deposit and redeem passes against the real frontend/backend and local chain. The backend publishes 66 prices; redemption reconciles 120 USDT gross, 2 USDT creator fee and 118 USDT net.
- Official OpenFour source was pinned at commit `079a45e9c3358c9f357c84f336c7d915c9f0e9fc`. On a developer-owned BSC-testnet fork the IndexFi token/vault/curve/trade/migrate implementations registered successfully, and `scripts/verify-indexfi-openfour.js` created and seeded a vault through the real Core.
- No public-chain write was performed. Local generated addresses are fixtures, not chain-97 deployment data.
- npm reported 45 dependency advisories (12 high); dependency review is pending. No automatic breaking upgrades were applied to the pinned starter.

The remaining release gates are a production Pancake execution adapter, verified
chain-97 token/route addresses, and a trusted delivery path for the OpenFour
Core signer's per-launch authorization. The key must remain outside frontend and
repository code.
