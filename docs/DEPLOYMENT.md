# Deployment Gates

## Environments

Development may use `LUCID_ENABLE_DEV_AUTH=true`, automatic schema creation and the in-memory rate limiter. Staging and production must set `LUCID_ENV` explicitly and use PostgreSQL, Alembic, Firebase Admin credentials from the platform secret manager and a distributed rate-limit backend.

## Release

Run `scripts/release_gate.sh` in CI or the deployment runner. In staging/production it first validates required configuration, then runs the Python tests, TypeScript typecheck, production build, Alembic head check and whitespace validation. A failed gate blocks release.

CI also produces an `npm audit` JSON artifact. Critical dependency findings block the build; high/moderate findings are retained for dependency review because the current Genkit/OpenTelemetry dependency tree contains advisories without non-breaking upstream fixes.

## Test Layers

- Unit and API regression tests: `npm run test:backend`
- Dataset and guided-step validators: `npm run validate:knowledge` and `npm run validate:safety`
- PostgreSQL migration gate: `python3 -m alembic upgrade head` followed by `python3 -m alembic check`
- Frontend type and production build: `npm run typecheck` and `npm run build`
- Full local gate: `npm run test:all`

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

The GitHub Actions `deploy` job is a protected release handoff after all CI jobs pass. Firebase App Hosting deploys from its connected GitHub repository, so deployment status is visible in Firebase Console under `App Hosting`. Configure a protected GitHub Environment named `production` and add required reviewers if production approval is desired. No Firebase service-account secret or project-ID variable is required by this repository workflow.
