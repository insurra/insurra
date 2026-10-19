import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, select, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from app.core.config import ROOT, get_settings
from app.core.database import Base, make_engine, session_factory
from app.models import (
    AuditRow,
    ConsentRow,
    DemoSessionRow,
    InsuranceRecordRow,
    ProfileRow,
    PurposeConsentRow,
)
from app.seeds.demo import seed_personas


def test_upgrade_retains_all_legacy_data_and_does_not_infer_ai_consent(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'upgrade.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    cfg = Config(str(ROOT / "backend/alembic.ini"))
    command.upgrade(cfg, "0001")
    engine = make_engine(url)
    factory = session_factory(engine)
    with factory() as db:
        assert seed_personas(db) == 2
        for index, granted in enumerate([False, True]):
            session_id, profile_id, record_id = uuid4(), uuid4(), uuid4()
            now = datetime.now(UTC)
            db.add(
                DemoSessionRow(
                    id=session_id,
                    persona_id="raka",
                    token_hash=hashlib.sha256(f"synthetic-{index}".encode()).hexdigest(),
                    created_at=now,
                    expires_at=now + timedelta(hours=24),
                )
            )
            db.flush()
            profile = json.loads((ROOT / "fixtures/raka/profile.json").read_text())
            profile["id"] = str(profile_id)
            db.add(ProfileRow(id=profile_id, session_id=session_id, payload=profile))
            db.flush()
            record = json.loads((ROOT / "fixtures/raka/insurance_record.json").read_text())
            record.update(id=str(record_id), profile_id=str(profile_id))
            db.add(
                InsuranceRecordRow(
                    id=record_id, session_id=session_id, profile_id=profile_id, payload=record
                )
            )
            db.add(ConsentRow(session_id=session_id, processing_consent=granted, updated_at=now))
            db.add(
                AuditRow(
                    id=uuid4(),
                    session_id=session_id,
                    event_type="CONSENT_GRANTED" if granted else "SESSION_CREATED",
                    outcome="SUCCESS",
                    event_metadata={"processing_consent": granted},
                    created_at=now,
                )
            )
        db.commit()
    legacy_tables = [
        "demo_sessions",
        "profiles",
        "consents",
        "insurance_records",
        "audit_events",
        "persona_templates",
    ]

    def snapshot():
        with engine.connect() as connection:
            return {
                name: sorted(
                    tuple(map(str, row))
                    for row in connection.execute(text(f"SELECT * FROM {name}"))
                )
                for name in legacy_tables
            }

    before = snapshot()
    command.upgrade(cfg, "head")
    assert snapshot() == before
    with factory() as db:
        rows = list(db.scalars(select(PurposeConsentRow)))
        assert len(rows) == 6
        assert sum(row.granted for row in rows) == 1
        for row in rows:
            legacy = db.get(ConsentRow, row.session_id)
            assert row.granted == (
                legacy.processing_consent if row.purpose == "process_documents" else False
            )
            assert (row.granted_at is not None) == row.granted
            assert row.policy_version == "legacy-v1" and row.revoked_at is None
        assert seed_personas(db) == 0
    command.upgrade(cfg, "head")
    assert snapshot() == before
    assert {"documents", "extracted_fields", "claim_cases", "actions", "purpose_consents"} <= set(
        inspect(engine).get_table_names()
    )
    engine.dispose()
    get_settings.cache_clear()


def test_new_tables_compile_for_postgresql_without_connecting():
    for name in [
        "purpose_consents",
        "documents",
        "extracted_fields",
        "claim_cases",
        "actions",
        "accounts",
        "oauth_identities",
        "account_sessions",
    ]:
        sql = str(CreateTable(Base.metadata.tables[name]).compile(dialect=postgresql.dialect()))
        assert "UUID" in sql and "CREATE TABLE" in sql


def test_action_review_metadata_upgrade_keeps_existing_status_and_payload(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'actions-upgrade.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    cfg = Config(str(ROOT / "backend/alembic.ini"))
    command.upgrade(cfg, "0008")
    engine = make_engine(url)
    session_id, action_id = uuid4(), uuid4()
    now = datetime.now(UTC).isoformat()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO demo_sessions "
                "(id, token_hash, persona_id, created_at, expires_at) "
                "VALUES (:id, :token_hash, :persona_id, :created_at, :expires_at)"
            ),
            {
                "id": session_id.hex,
                "token_hash": "a" * 64,
                "persona_id": "raka",
                "created_at": now,
                "expires_at": now,
            },
        )
        connection.execute(
            text(
                "INSERT INTO actions (id, session_id, type, payload, status) "
                "VALUES (:id, :session_id, :type, :payload, :status)"
            ),
            {
                "id": action_id.hex,
                "session_id": session_id.hex,
                "type": "claim_submit",
                "payload": '{"claim_case_id":"synthetic"}',
                "status": "PENDING",
            },
        )
    command.upgrade(cfg, "0009")
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT status, payload, created_at, payload_version FROM actions WHERE id=:id"),
            {"id": action_id.hex},
        ).one()
    assert row.status == "PENDING"
    assert row.payload == '{"claim_case_id":"synthetic"}'
    assert row.created_at is None and row.payload_version is None
    engine.dispose()
    get_settings.cache_clear()


def test_claim_tracking_upgrade_preserves_existing_case_status(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'claim-tracking-upgrade.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    cfg = Config(str(ROOT / "backend/alembic.ini"))
    command.upgrade(cfg, "0009")
    engine = make_engine(url)
    session_id, claim_id, coverage_id = uuid4(), uuid4(), uuid4()
    now = datetime.now(UTC).isoformat()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO demo_sessions (id, token_hash, persona_id, created_at, expires_at) "
                "VALUES (:id, :token_hash, :persona_id, :created_at, :expires_at)"
            ),
            {
                "id": session_id.hex,
                "token_hash": "b" * 64,
                "persona_id": "raka",
                "created_at": now,
                "expires_at": now,
            },
        )
        connection.execute(
            text(
                "INSERT INTO claim_cases "
                "(id, session_id, coverage_id, country_code, path, status, created_at) "
                "VALUES (:id, :session_id, :coverage_id, :country_code, :path, "
                ":status, :created_at)"
            ),
            {
                "id": claim_id.hex,
                "session_id": session_id.hex,
                "coverage_id": coverage_id.hex,
                "country_code": "ID",
                "path": "manual",
                "status": "DRAFT",
                "created_at": now,
            },
        )
    command.upgrade(cfg, "0010")
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT status, claim_ref, sandbox_status, last_checked_at, monitoring_state "
                "FROM claim_cases WHERE id=:id"
            ),
            {"id": claim_id.hex},
        ).one()
        assert "claim_case_events" in inspect(connection).get_table_names()
    assert row.status == "DRAFT"
    assert (
        row.claim_ref is row.sandbox_status is row.last_checked_at is row.monitoring_state is None
    )
    engine.dispose()
    get_settings.cache_clear()
