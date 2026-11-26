#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$ROOT/backend" && bash check.sh)
(cd "$ROOT/contracts/openfour" && npm ci && npm run compile && npm test)
(cd "$ROOT/frontend" && corepack pnpm install --frozen-lockfile && corepack pnpm registry:check && corepack pnpm typecheck && corepack pnpm test && corepack pnpm build)
