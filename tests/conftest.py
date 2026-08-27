from __future__ import annotations

import os
from pathlib import Path

# Force a deterministic SQLite database and dev auth before any lucid_backend
# module is imported. Tests that need PostgreSQL (test_phase2_postgres.py) pass
# their own DATABASE_URL into subprocesses and are unaffected.
os.environ["DATABASE_URL"] = f"sqlite:///{Path('.tmp_lucid_test.db')}"
os.environ["LUCID_ENABLE_DEV_AUTH"] = "true"

import pytest


@pytest.fixture(autouse=True)
def reset_database() -> None:
    """Give every test a clean, freshly seeded SQLite database.

    The whole suite previously shared one module-level SQLite file, making
    tests order-dependent. Dropping and re-creating the schema plus seed data
    before each test removes cross-test state leakage.
    """
    from sqlalchemy.orm import Session

    from lucid_backend.database import Base, engine
    from lucid_backend.services import seed_demo_data

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with Session(engine) as db:
        seed_demo_data(db)
        db.commit()
    yield
