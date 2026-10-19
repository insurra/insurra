"""Actor isolation, deterministic field reading and populated migration preservation."""

from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import MetaData, Table, insert, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateTable

from app.core.config import ROOT, get_settings
from app.core.database import Base, make_engine
from app.models import AccountFieldRow, ClauseChunkRow
from app.schemas.actor import Actor
from app.services.benefits import financial_facts
from app.services.workspace import coverages, grants, profile
from app.tests.workspace_fixtures import workspace


@pytest.fixture
def kb_countries() -> str:
    # Settings override scoped to this module: it uses the inactive legacy kb/AU folder as a
    # fixture-only configuration. The default app keeps AU disabled (see conftest).
    return "AU,CN,ID"


def test_account_adapter_uses_existing_fields_without_copying_or_cross_actor_data(app, client):
    _, account, coverage, doc = workspace(app, client)
    _, other, _, _ = workspace(app, client)
    with app.state.session_factory() as db:
        actor = Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=account)
        items = coverages(db, actor, app.state.kb_loader)
        assert [c.id for c in items] == [coverage]
        assert items[0].document_ids == [doc] and items[0].verified
        assert items[0].active(date(2026, 10, 18))
        assert grants(db, actor)["retention"]
        assert profile(db, actor).display_name == "Raka"
        assert all(
            c.id != coverage
            for c in coverages(
                db, Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=other), app.state.kb_loader
            )
        )
        f = db.scalar(
            select(AccountFieldRow).where(
                AccountFieldRow.coverage_id == coverage,
                AccountFieldRow.field_key == "coverage_end_date",
            )
        )
        f.status, f.confirmed_by_user, f.confidence = "UNVERIFIED", False, None
        db.commit()
        assert not coverages(db, actor, app.state.kb_loader)[0].verified


@pytest.mark.parametrize(
    "used,expected,over", [("120", "380", False), (None, None, False), ("600", "0", True)]
)
def test_decimal_remaining_limit_normal_unknown_and_over_limit(app, client, used, expected, over):
    _, account, coverage, _ = workspace(app, client)
    with app.state.session_factory() as db:
        f = db.scalar(
            select(AccountFieldRow).where(
                AccountFieldRow.coverage_id == coverage,
                AccountFieldRow.field_key == "benefit_outpatient_used_amount",
            )
        )
        f.value = used
        db.commit()
        c = coverages(
            db, Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=account), app.state.kb_loader
        )[0]
        result = financial_facts(c, date(2026, 10, 18))[0]
        assert result.remaining == expected and result.over_limit == over
        assert result.currency == "AUD"
        assert result.label == ("NEEDS_CONFIRMATION" if used is None else "FROM_DOCUMENT")
        c.fields["benefit_outpatient_period_start"].value = "2028-01-01"
        assert financial_facts(c, date(2026, 10, 18))[0].remaining is None


def test_database_rejects_cross_account_clause_reference(app, client):
    _, account, coverage, doc = workspace(app, client)
    _, other, _, _ = workspace(app, client)
    with app.state.session_factory() as db:
        db.add(
            ClauseChunkRow(
                account_id=other,
                coverage_id=coverage,
                document_id=doc,
                page_no=1,
                start_offset=0,
                end_offset=10,
                text_sha256="a" * 64,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        db.add(
            ClauseChunkRow(
                account_id=account,
                coverage_id=coverage,
                document_id=doc,
                page_no=1,
                start_offset=0,
                end_offset=10,
                text_sha256="a" * 64,
            )
        )
        db.commit()


def test_retention_revocation_purges_pages_chunks_and_history_not_reviewed_fields(app, client):
    from app.models import AccountDocumentPageRow, ChatSessionRow
    from app.tests.test_account_workspace import grant

    headers, account, coverage, doc = workspace(app, client)
    with app.state.session_factory() as db:
        db.add(
            ClauseChunkRow(
                account_id=account,
                coverage_id=coverage,
                document_id=doc,
                page_no=1,
                start_offset=0,
                end_offset=10,
                text_sha256="a" * 64,
            )
        )
        db.add(ChatSessionRow(account_id=account, coverage_id=coverage, turns=[]))
        db.commit()
    grant(client, headers, "retention", False)
    detail = client.get(f"/api/v1/account/documents/{doc}", headers=headers).json()
    assert detail["pages"] == [] and detail["fields"]
    with app.state.session_factory() as db:
        assert db.scalar(select(ClauseChunkRow).where(ClauseChunkRow.account_id == account)) is None
        assert db.scalar(select(ChatSessionRow).where(ChatSessionRow.account_id == account)) is None
        assert (
            db.scalar(
                select(AccountDocumentPageRow).where(AccountDocumentPageRow.document_id == doc)
            )
            is None
        )
    grant(client, headers, "retention")
    assert client.get(f"/api/v1/account/documents/{doc}", headers=headers).json()["pages"] == []


def test_ingestion_without_retention_does_not_store_raw_pages(app, client, monkeypatch):
    from app.services.account_documents import ExtractionResult, PageText

    headers, _, _, _ = workspace(app, client, retention=False)
    monkeypatch.setattr(
        "app.api.v1.account_documents.extract_text_or_ocr",
        lambda *_: [PageText(page_no=1, text="Fictional private text", ocr_used=False)],
    )
    monkeypatch.setattr(
        "app.api.v1.account_documents.extract_to_schema", lambda *_: ExtractionResult(fields=[])
    )
    response = client.post(
        "/api/v1/account/documents",
        headers=headers,
        files={"file": ("new.pdf", b"%PDF-new-fictional", "application/pdf")},
        data={"kind": "policy_booklet"},
    )
    assert response.status_code == 201, response.text
    detail = client.get(
        f"/api/v1/account/documents/{response.json()['document_id']}", headers=headers
    ).json()
    assert detail["pages"] == [] and detail["original_file_status"] == "DELETED"


def test_workspace_tables_compile_for_postgresql():
    for name in [
        "clause_chunks",
        "recommendation_states",
        "ask_limits",
        "chat_sessions",
        "pathway_decisions",
        "claim_cases",
    ]:
        assert "CREATE TABLE" in str(
            CreateTable(Base.metadata.tables[name]).compile(dialect=postgresql.dialect())
        )


def test_0008_preserves_existing_claim_and_action_links(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'populated.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    cfg = Config(str(ROOT / "backend/alembic.ini"))
    command.upgrade(cfg, "0007")
    engine = make_engine(url)
    meta = MetaData()
    tables = {
        name: Table(name, meta, autoload_with=engine)
        for name in ("demo_sessions", "claim_cases", "actions")
    }
    session, case, action, now = uuid4().hex, uuid4().hex, uuid4().hex, datetime.now(UTC)
    with engine.begin() as connection:
        connection.execute(
            insert(tables["demo_sessions"]).values(
                id=session,
                persona_id="raka",
                token_hash="a" * 64,
                created_at=now,
                expires_at=now + timedelta(days=1),
            )
        )
        connection.execute(
            insert(tables["claim_cases"]).values(
                id=case,
                session_id=session,
                coverage_id=uuid4().hex,
                country_code="AU",
                path="GP",
                status="DRAFT",
                created_at=now,
            )
        )
        connection.execute(
            insert(tables["actions"]).values(
                id=action,
                session_id=session,
                claim_case_id=case,
                type="claim_submit",
                status="PENDING",
                payload={"synthetic": True},
            )
        )
    command.upgrade(cfg, "head")
    with engine.connect() as connection:
        assert connection.execute(select(tables["claim_cases"])).one().id == case
        assert connection.execute(select(tables["actions"])).one().claim_case_id == case
    engine.dispose()
    get_settings.cache_clear()
