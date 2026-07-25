#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

CONTAINER_NAME="${LUCID_PG_CONTAINER:-lucid-postgres}"
PG_IMAGE="${LUCID_PG_IMAGE:-postgres:16}"
PG_USER="${LUCID_PG_USER:-postgres}"
PG_PASSWORD="${LUCID_PG_PASSWORD:-postgres}"
PG_DB="${LUCID_PG_DB:-lucid_engineer_flow}"
PG_PORT="${LUCID_PG_PORT:-5432}"
APP_PORT="${LUCID_APP_PORT:-8010}"
ENV_FILE="${LUCID_ENV_FILE:-.env.lucid}"

RUN_TESTS=0
START_API=1

usage() {
  cat <<'EOF'
Usage: ./run_postgres.sh [--with-tests] [--no-api]

Options:
  --with-tests   Start API, run test_lucid.py + test_werkbon_factuur.py, then continue.
  --no-api       Prepare DB/env only; do not start uvicorn.
  -h, --help     Show this help.
EOF
}

log() {
  printf "\n==> %s\n" "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "FOUT: command '$1' niet gevonden."
    exit 1
  fi
}

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp_file
  tmp_file="$(mktemp)"

  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ ("^" key "=") { print key "=" value; updated = 1; next }
    { print }
    END { if (!updated) print key "=" value }
  ' "$file" > "$tmp_file"

  mv "$tmp_file" "$file"
}

for arg in "$@"; do
  case "$arg" in
    --with-tests)
      RUN_TESTS=1
      ;;
    --no-api)
      START_API=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Onbekende optie: $arg"
      usage
      exit 1
      ;;
  esac
done

require_cmd docker
require_cmd python3

log "Postgres container controleren: $CONTAINER_NAME"
if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  if docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    log "Container draait al"
  else
    log "Bestaande container starten"
    docker start "$CONTAINER_NAME" >/dev/null
  fi
else
  log "Nieuwe Postgres container aanmaken"
  docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER="$PG_USER" \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" \
    -e POSTGRES_DB="$PG_DB" \
    -p "$PG_PORT:5432" \
    "$PG_IMAGE" >/dev/null
fi

log "Wachten op PostgreSQL readiness"
ready=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "FOUT: PostgreSQL werd niet op tijd ready."
  exit 1
fi

DATABASE_URL="postgresql+psycopg://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}"
touch "$ENV_FILE"
upsert_env "$ENV_FILE" "DATABASE_URL" "$DATABASE_URL"
upsert_env "$ENV_FILE" "LUCID_ENABLE_DEV_AUTH" "true"
upsert_env "$ENV_FILE" "LUCID_JWT_ISSUER" "lucid-internal-issuer"
upsert_env "$ENV_FILE" "LUCID_JWT_AUDIENCE" "lucid-engineer-flow"
upsert_env "$ENV_FILE" "LUCID_HMAC_SECRET" "lucid-dev-hmac-secret"
upsert_env "$ENV_FILE" "LUCID_TRIGGER1_BATCH_INTERVAL_MINUTES" "60"
log "Env geconfigureerd in $ENV_FILE"

if [ ! -x ".venv/bin/python" ]; then
  log "Python virtualenv aanmaken"
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
. .venv/bin/activate

log "Dependencies installeren/updaten"
python -m pip install -q -U pip
python -m pip install -q -r requirements-lucid.txt

set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

log "Alembic migraties uitvoeren"
python -m alembic upgrade head

log "Seed data laden"
python - <<'PY'
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from lucid_backend.database import engine
from lucid_backend.models import DiagnosisEvent, Party, Vehicle
from lucid_backend.services import seed_demo_data

with Session(engine) as db:
    seed_demo_data(db)
    db.commit()
    parties = db.execute(select(func.count(Party.id))).scalar_one()
    vehicles = db.execute(select(func.count(Vehicle.id))).scalar_one()
    events = db.execute(select(func.count(DiagnosisEvent.id))).scalar_one()
    print(f"seed_ok parties={parties} vehicles={vehicles} diagnosis_events={events}")
PY

if [ "$RUN_TESTS" -eq 1 ]; then
  require_cmd curl
  log "API tijdelijk starten voor test_lucid.py en test_werkbon_factuur.py"
  python -m uvicorn lucid_engineer_flow:app --port "$APP_PORT" >/tmp/lucid_uvicorn.log 2>&1 &
  api_pid=$!

  cleanup_test_api() {
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  }
  trap cleanup_test_api EXIT

  ok=0
  for _ in $(seq 1 40); do
    if curl -sS "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 1
  done
  if [ "$ok" -ne 1 ]; then
    echo "FOUT: API health check faalde tijdens tests."
    tail -n 80 /tmp/lucid_uvicorn.log || true
    exit 1
  fi

  log "test_lucid.py uitvoeren"
  LUCID_TEST_BASE_URL="http://127.0.0.1:${APP_PORT}" python test_lucid.py

  log "test_werkbon_factuur.py uitvoeren"
  LUCID_TEST_BASE_URL="http://127.0.0.1:${APP_PORT}" python test_werkbon_factuur.py

  cleanup_test_api
  trap - EXIT
fi

if [ "$START_API" -eq 1 ]; then
  log "API starten op http://127.0.0.1:${APP_PORT}"
  exec python -m uvicorn lucid_engineer_flow:app --reload --port "$APP_PORT"
fi

log "Klaar (API niet gestart door --no-api)."
