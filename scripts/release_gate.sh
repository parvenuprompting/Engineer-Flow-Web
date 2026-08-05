#!/usr/bin/env bash
set -euo pipefail

if [[ "${LUCID_ENV:-}" == "staging" || "${LUCID_ENV:-}" == "production" ]]; then
  python3 scripts/validate_production_env.py
fi

python3 -m pytest -q
npm run build
npm run typecheck
python3 -m alembic heads
git diff --check
