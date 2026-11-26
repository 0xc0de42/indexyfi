#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
uv sync --all-packages --locked
uv run ruff check packages services tests
uv run ruff format --check packages services tests
uv run mypy -p ind_core -p ind_config -p ind_logger -p ind_ws -p ind_atlas -p ind_assets -p ind_snapshot -p ind_fs -p ind_history -p ind_cmc -p ind_server
uv run pytest -ra
uv run python -m ind_server --help
