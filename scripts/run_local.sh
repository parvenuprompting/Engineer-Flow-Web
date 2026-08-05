#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${LUCID_ENV_FILE:-.env.lucid}"
APP_PORT="${LUCID_APP_PORT:-8010}"

./scripts/run_postgres.sh --no-api

set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

export LUCID_BACKEND_URL="${LUCID_BACKEND_URL:-http://127.0.0.1:${APP_PORT}}"

echo "==> FastAPI starten op $LUCID_BACKEND_URL"
python -m uvicorn lucid_engineer_flow:app --port "$APP_PORT" >/tmp/engineer-flow-lucid-api.log 2>&1 &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=0
for _ in $(seq 1 40); do
  if curl -sS "${LUCID_BACKEND_URL}/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "FOUT: FastAPI healthcheck faalde. Bekijk /tmp/engineer-flow-lucid-api.log"
  exit 1
fi

echo "==> Next.js starten op http://127.0.0.1:9002"
npm run dev
