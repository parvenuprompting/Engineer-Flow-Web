# Phase 2 Data Policy

## Transaction Boundary

Every durable domain write runs in the request's SQLAlchemy transaction and is committed once at the end of the operation. A failed flush or commit rolls back the complete request transaction. Diagnosis persistence includes its manifest, policy decision, audit event and diagnosis row in the same transaction.

## Foreign Keys

Ownership relationships use restrictive deletion by default. A garage, user, vehicle, case, work order or invoice must not be deleted implicitly while dependent audit or financial records exist. Memberships and work-order lines may be retired or revoked by status; they are not physically cascaded as part of ordinary domain operations.

The exception is explicitly owned ephemeral data such as a work-order line when a work order is removed in a controlled maintenance operation. Such deletion must use an explicit migration and audit event, never ORM-side implicit deletion.

## Idempotency

Durable create operations accept an `idempotency_key` and enforce uniqueness at the database layer. Replaying a key returns the existing resource instead of creating a second case, work order or invoice. Diagnosis persistence already has the same guarantee.

## Production Schema

Production never calls `Base.metadata.create_all()` and never seeds demo data. Alembic is the only schema-evolution path. Local schema creation is development-only and controlled by `LUCID_AUTO_CREATE_SCHEMA`.
