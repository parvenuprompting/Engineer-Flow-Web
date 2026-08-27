from __future__ import annotations

import os
import subprocess
import sys

import pytest


POSTGRES_URL = os.getenv("PHASE2_POSTGRES_URL")

# PHASE2_POSTGRES_URL uses "postgresql+psycopg://..." (SQLAlchemy dialect). psycopg
# accepts a plain "postgresql://..." DSN.
PSYCOPG_DSN = (POSTGRES_URL or "").replace("postgresql+psycopg://", "postgresql://")


def _run_alembic(args: list[str]) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "DATABASE_URL": POSTGRES_URL or ""}
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


needs_postgres = pytest.mark.skipif(not POSTGRES_URL, reason="Set PHASE2_POSTGRES_URL to run the PostgreSQL 16 migration gate")


@pytest.mark.postgres_gate
@needs_postgres
def test_postgres_migrations_reach_head() -> None:
    result = _run_alembic(["upgrade", "head"])
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.postgres_gate
@needs_postgres
def test_empty_database_factuur_sequence_starts_at_one() -> None:
    """De factuurnummersequentie moet op 1 beginnen op een lege database."""
    reset = _run_alembic(["downgrade", "base"])
    assert reset.returncode == 0, reset.stdout + reset.stderr
    upgrade = _run_alembic(["upgrade", "head"])
    assert upgrade.returncode == 0, upgrade.stdout + upgrade.stderr

    import psycopg

    with psycopg.connect(PSYCOPG_DSN) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT nextval('factuur_number_seq')")
            value = cursor.fetchone()[0]

    assert value == 1, f"Verwachte factuursequentie start op 1, kreeg {value}"
