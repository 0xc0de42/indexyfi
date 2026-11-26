#!/usr/bin/env bash
# Run only against the disposable local deployment, with backend and Next running.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend/apps/web"
INDEXFI_V5_SMOKE=1 NEXT_PUBLIC_VAULT_CHAIN_ID=31337 corepack pnpm exec vitest run lib/integration-v5.test.ts
