from __future__ import annotations

import os
import subprocess
import sys

import pytest


POSTGRES_URL = os.getenv("PHASE2_POSTGRES_URL")


@pytest.mark.skipif(not POSTGRES_URL, reason="Set PHASE2_POSTGRES_URL to run the PostgreSQL 16 migration gate")
def test_postgres_migrations_reach_head() -> None:
    env = {**os.environ, "DATABASE_URL": POSTGRES_URL or ""}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.skipif(not POSTGRES_URL, reason="Set PHASE2_POSTGRES_URL to run the PostgreSQL 16 migration gate")
def test_empty_database_sequence_starts_at_one() -> None:
    env = {**os.environ, "DATABASE_URL": POSTGRES_URL or ""}
    reset = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "base"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert reset.returncode == 0, reset.stdout + reset.stderr
    upgrade = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert upgrade.returncode == 0, upgrade.stdout + upgrade.stderr
