from __future__ import annotations

import json
import os
import sys


def validate(environment: str) -> list[str]:
    if environment not in {"staging", "production"}:
        return ["environment must be staging or production"]
    errors: list[str] = []
    if os.getenv("LUCID_ENABLE_DEV_AUTH", "false").lower() == "true":
        errors.append("LUCID_ENABLE_DEV_AUTH must be false")
    if os.getenv("LUCID_AUTO_CREATE_SCHEMA", "false").lower() == "true":
        errors.append("LUCID_AUTO_CREATE_SCHEMA must be false")
    if not os.getenv("DATABASE_URL", "").startswith("postgresql"):
        errors.append("DATABASE_URL must point to PostgreSQL")
    if not os.getenv("LUCID_SERVICE_TOKEN"):
        errors.append("LUCID_SERVICE_TOKEN is required")
    if not os.getenv("LUCID_HMAC_SECRET") or os.getenv("LUCID_HMAC_SECRET") == "lucid-dev-hmac-secret":
        errors.append("random LUCID_HMAC_SECRET is required")
    if not os.getenv("LUCID_EFL_AUDIT_INGEST_SECRET") or os.getenv("LUCID_EFL_AUDIT_INGEST_SECRET") == "efl-local-sync-secret":
        errors.append("random LUCID_EFL_AUDIT_INGEST_SECRET is required")
    if not os.getenv("LUCID_ALLOWED_HOSTS"):
        errors.append("LUCID_ALLOWED_HOSTS is required")
    if not os.getenv("LUCID_CORS_ORIGINS"):
        errors.append("LUCID_CORS_ORIGINS is required")
    if os.getenv("LUCID_RATE_LIMIT_BACKEND") not in {"redis", "postgres"}:
        errors.append("distributed LUCID_RATE_LIMIT_BACKEND must be redis or postgres")
    raw_keys = os.getenv("LUCID_JWT_PUBLIC_KEYS_JSON", "")
    try:
        if not json.loads(raw_keys):
            errors.append("LUCID_JWT_PUBLIC_KEYS_JSON must contain keys")
    except json.JSONDecodeError:
        errors.append("LUCID_JWT_PUBLIC_KEYS_JSON must be valid JSON")
    return errors


if __name__ == "__main__":
    environment = os.getenv("LUCID_ENV", "")
    errors = validate(environment)
    if errors:
        print("Production configuration invalid:")
        print("\n".join(f"- {error}" for error in errors))
        raise SystemExit(1)
    print("Production configuration valid")
