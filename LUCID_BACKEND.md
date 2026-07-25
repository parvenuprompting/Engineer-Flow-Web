# LUCID Engineer Flow v0.2 Backend

## Start

```bash
pip install -r requirements-lucid.txt
alembic upgrade head
uvicorn lucid_engineer_flow:app --reload
```

Open Swagger: `http://localhost:8000/docs`

## Auth

All protected endpoints require `Authorization: Bearer <JWT>`.

JWT requirements:
- `iss` = `LUCID_JWT_ISSUER` (default: `lucid-internal-issuer`)
- `aud` = `LUCID_JWT_AUDIENCE` (default: `lucid-engineer-flow`)
- claims: `sub`, `party_type`, `party_id`, `scopes`, `exp`
- header: `kid`

For local development you can mint a token via:
- `POST /auth/dev-token`

## Key endpoints

- `POST /data/opvragen` (manifest-driven, audited)
- `POST /claims`
- `POST /claims/{claim_id}/close`
- `POST /consents`
- `POST /fabrikant/update`
- `POST /jobs/trigger1/run`
- `GET /manifest/audit/{manifest_id}`
- `GET /health`
- `GET /policy/version`

## Environment variables

- `DATABASE_URL`
- `LUCID_JWT_ISSUER`
- `LUCID_JWT_AUDIENCE`
- `LUCID_JWT_PUBLIC_KEYS_JSON`
- `LUCID_JWT_PRIVATE_KEYS_JSON`
- `LUCID_DEFAULT_JWT_KID`
- `LUCID_HMAC_SECRET`
- `LUCID_RATE_LIMIT_WINDOW`
- `LUCID_RATE_LIMIT_PER_WINDOW`
- `LUCID_TRIGGER1_WINDOW_HOURS`
- `LUCID_TRIGGER1_BATCH_INTERVAL_MINUTES`
- `LUCID_ENABLE_DEV_AUTH`
