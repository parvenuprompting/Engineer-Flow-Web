# Deployment Gates

## Environments

Development may use `LUCID_ENABLE_DEV_AUTH=true`, automatic schema creation and the in-memory rate limiter. Staging and production must set `LUCID_ENV` explicitly and use PostgreSQL, Alembic, Firebase Admin credentials from the platform secret manager and a distributed rate-limit backend.

## Release

Run `scripts/release_gate.sh` in CI or the deployment runner. In staging/production it first validates required configuration, then runs the Python tests, TypeScript typecheck, production build, Alembic head check and whitespace validation. A failed gate blocks release.

Apply database migrations before starting the new application revision:

```bash
DATABASE_URL="$DATABASE_URL" python3 -m alembic upgrade head
```

Never run `Base.metadata.create_all()` or demo seeding in staging/production.

## Rollback

1. Stop traffic to the new revision.
2. Deploy the previous immutable application revision.
3. Restore the database only after assessing whether the migration is backward-compatible.
4. If rollback requires schema reversal, execute the reviewed Alembic downgrade in a maintenance window.
5. Verify `/health`, dataset health and the diagnosis-to-work-order smoke path before reopening traffic.

Backups and restore drills are deployment-owner responsibilities and must be recorded per environment.
