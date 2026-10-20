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
            # 0001 predates demo_sessions.revoked_at, so insert only the original columns.
            db.execute(
                text(
                    "INSERT INTO demo_sessions (id, token_hash, persona_id, created_at, "
                    "expires_at) VALUES (:id, :token_hash, :persona_id, :created_at, :expires_at)"
                ),
                {
                    "id": session_id.hex,
                    "token_hash": hashlib.sha256(f"synthetic-{index}".encode()).hexdigest(),
                    "persona_id": "raka",
                    "created_at": now,
                    "expires_at": now + timedelta(hours=24),
                },
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
                    for row in connection.execute(
                        text(
                            "SELECT id, token_hash, persona_id, created_at, expires_at "
                            "FROM demo_sessions"
                            if name == "demo_sessions"
                            else f"SELECT * FROM {name}"
                        )
                    )
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


def _insert_session_and_account(connection, session_id, account_id, now):
    connection.execute(
        text(
            "INSERT INTO demo_sessions (id, token_hash, persona_id, created_at, expires_at) "
            "VALUES (:id, :token_hash, 'raka', :now, :now)"
        ),
        {"id": session_id.hex, "token_hash": "c" * 64, "now": now},
    )
    connection.execute(
        text(
            "INSERT INTO accounts (id, email, email_verified, verification_token, "
            "failed_login_attempts, consent_decided, created_at, updated_at) "
            "VALUES (:id, 'legacy@insurra.test', 0, 'legacy-plain-token', 0, 0, :now, :now)"
        ),
        {"id": account_id.hex, "now": now},
    )


def test_0013_fresh_upgrade_creates_context_schema(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'fresh-0013.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    command.upgrade(Config(str(ROOT / "backend/alembic.ini")), "head")
    engine = make_engine(url)
    tables = inspect(engine)
    assert {"notifications", "user_preferences"} <= set(tables.get_table_names())
    assert "revoked_at" in {c["name"] for c in tables.get_columns("demo_sessions")}
    assert "verification_token_expires_at" in {c["name"] for c in tables.get_columns("accounts")}
    notification_columns = {c["name"] for c in tables.get_columns("notifications")}
    assert {
        "account_id",
        "session_id",
        "dedupe_key",
        "read_at",
        "deep_link",
    } <= notification_columns
    for table in ("notifications", "user_preferences"):
        assert tables.get_check_constraints(table)
        assert {fk["options"].get("ondelete") for fk in tables.get_foreign_keys(table)} == {
            "CASCADE"
        }
    engine.dispose()
    get_settings.cache_clear()


def test_0013_populated_upgrade_from_0012_preserves_rows_and_enforces_owner(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'populated-0013.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    cfg = Config(str(ROOT / "backend/alembic.ini"))
    command.upgrade(cfg, "0012")
    engine = make_engine(url)
    session_id, account_id = uuid4(), uuid4()
    now = datetime.now(UTC).isoformat()
    with engine.begin() as connection:
        _insert_session_and_account(connection, session_id, account_id, now)
    command.upgrade(cfg, "0013")
    with engine.begin() as connection:
        session_row = connection.execute(
            text("SELECT token_hash, revoked_at FROM demo_sessions WHERE id=:id"),
            {"id": session_id.hex},
        ).one()
        account_row = connection.execute(
            text("SELECT verification_token, verification_token_expires_at FROM accounts"),
        ).one()
        assert session_row.token_hash == "c" * 64 and session_row.revoked_at is None
        assert account_row.verification_token == "legacy-plain-token"
        assert account_row.verification_token_expires_at is None
        insert = (
            "INSERT INTO notifications (id, {owner}, type, category, priority, title, body, "
            "event_source, dedupe_key, created_at) VALUES (:id, :owner, 't', 'c', 'normal', "
            "'x', '', 'test', :key, :now)"
        )
        connection.execute(
            text(insert.format(owner="session_id")),
            {"id": uuid4().hex, "owner": session_id.hex, "key": "k1", "now": now},
        )
    for owner_column, owner, key in (
        ("session_id", session_id, "k1"),
        ("account_id", None, "k2"),
    ):
        owner_value = owner.hex if owner else None
        try:
            with engine.begin() as connection:
                connection.execute(
                    text(insert.format(owner=owner_column)),
                    {"id": uuid4().hex, "owner": owner_value, "key": key, "now": now},
                )
        except Exception as exc:  # noqa: BLE001
            assert "constraint" in str(exc).lower() or "NOT NULL" in str(exc)
        else:
            raise AssertionError("duplicate or ownerless notification accepted")
    engine.dispose()
    get_settings.cache_clear()


def test_0014_upgrade_from_0013_with_data_and_clean_downgrade(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'populated-0014.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    cfg = Config(str(ROOT / "backend/alembic.ini"))
    command.upgrade(cfg, "0013")
    engine = make_engine(url)
    session_id, account_id, event_id = uuid4(), uuid4(), uuid4()
    now = datetime.now(UTC).isoformat()
    with engine.begin() as connection:
        _insert_session_and_account(connection, session_id, account_id, now)
        connection.execute(
            text(
                "INSERT INTO wf_agent_events (id, owner_kind, owner_id, tool, outcome, detail, created_at) "
                "VALUES (:id, 'DEMO', :owner_id, 'legacy.tool', 'OK', '{}', :now)"
            ),
            {"id": event_id.hex, "owner_id": session_id.hex, "now": now},
        )
    command.upgrade(cfg, "0014")
    tables = inspect(engine)
    assert "protection_insights" in tables.get_table_names()
    assert "language" in {c["name"] for c in tables.get_columns("clause_chunks")}
    assert "workflow_state" in {c["name"] for c in tables.get_columns("chat_sessions")}
    assert {"origin_ref", "idempotency_key"} <= {
        c["name"] for c in tables.get_columns("wf_claim_cases")
    }
    assert {"fire_at", "timezone", "cancelled_at"} <= {
        c["name"] for c in tables.get_columns("wf_reminders")
    }
    assert {"event_type", "dedupe_key", "status", "attempts", "next_attempt_at"} <= {
        c["name"] for c in tables.get_columns("wf_agent_events")
    }
    with engine.begin() as connection:
        ev = connection.execute(
            text("SELECT status, attempts, schema_version FROM wf_agent_events WHERE id=:id"),
            {"id": event_id.hex},
        ).one()
        assert ev.status == "PENDING" and ev.attempts == 0 and ev.schema_version == "1.5"
    command.downgrade(cfg, "0013")
    tables_after = inspect(engine)
    assert "protection_insights" not in tables_after.get_table_names()
    assert "language" not in {c["name"] for c in tables_after.get_columns("clause_chunks")}
    command.upgrade(cfg, "head")
    engine.dispose()
    get_settings.cache_clear()


def test_0019_upgrade_from_0018_and_clean_downgrade(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'populated-0019.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    cfg = Config(str(ROOT / "backend/alembic.ini"))
    command.upgrade(cfg, "0018")
    engine = make_engine(url)
    command.upgrade(cfg, "0019")
    tables = inspect(engine)
    assert "account_protection_assessments" in tables.get_table_names()
    cols = {c["name"] for c in tables.get_columns("account_protection_assessments")}
    assert {
        "id",
        "account_id",
        "session_id",
        "assessment_version",
        "status",
        "covered_count",
        "attention_count",
        "unknown_count",
        "documents_needed_count",
        "overall_status",
        "overall_headline",
        "input_hash",
        "payload",
        "refresh_reason",
    } <= cols
    command.downgrade(cfg, "0018")
    tables_after = inspect(engine)
    assert "account_protection_assessments" not in tables_after.get_table_names()
    command.upgrade(cfg, "head")
    engine.dispose()
    get_settings.cache_clear()
