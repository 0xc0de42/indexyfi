# Validation — V5 candidate

## Actually executed

- `node --check` for all 17 JavaScript files: PASS.
- Relative Solidity imports resolved: 86 imports across 43 Solidity files (not a compiler test).
- JSON configuration parsing: PASS.
- Byte comparison against source archive: standard OpenFour token, StandardTokenModule and PancakeV2MigrateLib identical.
- `python checks/accounting_model.py`: PASS, 20,000 deterministic randomized integer arithmetic cases + seed and mixed-decimal examples. This is an independent model, not contract execution.
- DNS lookup / curl to registry.npmjs.org: failed; no network resolution.
- `npm ci --offline --ignore-scripts --no-audit --no-fund`: failed ENOTCACHED (yocto-queue tarball unavailable).
- `npm run compile` and `npm test`: failed before execution (`hardhat: not found`). **Zero V5 Solidity tests executed.**

## Pending

The 10 new V5 Hardhat test cases and preserved upstream starter tests are written but unexecuted. Prior V1 counts do not apply to this revision. Real Core fork experiment, official DEX swap execution, on-chain Atlas reads, chain-97 preflight, deployment, frontend E2E, gas/size review and security audit have not been performed. No fabricated ABIs, addresses or deployment manifests. No production-readiness claim.
