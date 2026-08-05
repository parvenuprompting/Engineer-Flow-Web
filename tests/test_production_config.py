from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "validate_production_env.py"


def _run(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    base = {key: value for key, value in os.environ.items() if key != "LUCID_ENV"}
    base.update(env)
    return subprocess.run([sys.executable, str(SCRIPT)], env=base, text=True, capture_output=True, check=False)


def test_production_validator_fails_closed_without_configuration() -> None:
    result = _run({"LUCID_ENV": "production"})

    assert result.returncode == 1
    assert "DATABASE_URL must point to PostgreSQL" in result.stdout
    assert "LUCID_SERVICE_TOKEN is required" in result.stdout


def test_production_validator_accepts_complete_configuration() -> None:
    result = _run(
        {
            "LUCID_ENV": "staging",
            "LUCID_ENABLE_DEV_AUTH": "false",
            "LUCID_AUTO_CREATE_SCHEMA": "false",
            "DATABASE_URL": "postgresql+psycopg://ci:ci@localhost:5432/lucid",
            "LUCID_SERVICE_TOKEN": "ci-service-token",
            "LUCID_HMAC_SECRET": "ci-random-hmac",
            "LUCID_EFL_AUDIT_INGEST_SECRET": "ci-random-audit",
            "LUCID_ALLOWED_HOSTS": "localhost",
            "LUCID_CORS_ORIGINS": "https://staging.example.com",
            "LUCID_RATE_LIMIT_BACKEND": "postgres",
            "LUCID_JWT_PUBLIC_KEYS_JSON": '{"ci-key":"public-key"}',
        }
    )

    assert result.returncode == 0, result.stdout
    assert result.stdout.strip() == "Production configuration valid"
