"""Tests for transactional outbox event dispatch and worker processing (B1.10, B1.11)."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from app.agent.worker import (
    RETRY_DELAYS,
    clear_consumers_for_test,
    process_due,
    register_consumer,
)
from app.models import AccountRow
from app.schemas.actor import Actor, ActorType
from app.services.actor_scope import owner_for
from app.services.events import dispatch
from app.tests.test_account_workspace import account_headers, grant
from app.workflow.models import WfAgentEventRow, WfAuditLogRow


def _account_actor(app, headers) -> Actor:
    import hashlib

    from app.models import AccountSessionRow

    token = headers["Authorization"].split()[1]
    with app.state.session_factory() as db:
        row = (
            db.query(AccountSessionRow)
            .filter_by(token_hash=hashlib.sha256(token.encode()).hexdigest())
            .one()
        )
        return Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=row.account_id)


def test_dispatch_writes_outbox_and_deduplicates_per_owner(app):
    headers_a = account_headers(app, "outbox_a")
    headers_b = account_headers(app, "outbox_b")
    actor_a = _account_actor(app, headers_a)
    actor_b = _account_actor(app, headers_b)
    owner_a = owner_for(actor_a)
    owner_b = owner_for(actor_b)

    with app.state.session_factory() as db:
        dispatch(
            db,
            actor_a,
            "profile.context.changed",
            str(owner_a.id),
            {"country_code": "CN"},
            dedupe_key="profile.context.changed:v1",
            entity_type="profile",
        )
        dispatch(
            db,
            actor_a,
            "profile.context.changed",
            str(owner_a.id),
            {"country_code": "CN"},
            dedupe_key="profile.context.changed:v1",
            entity_type="profile",
        )
        # Same dedupe_key for a different owner is allowed
        dispatch(
            db,
            actor_b,
            "profile.context.changed",
            str(owner_b.id),
            {"country_code": "ID"},
            dedupe_key="profile.context.changed:v1",
            entity_type="profile",
        )
        db.commit()

    with app.state.session_factory() as db:
        rows_a = db.scalars(
            select(WfAgentEventRow).where(
                WfAgentEventRow.owner_kind == owner_a.kind,
                WfAgentEventRow.owner_id == owner_a.id,
            )
        ).all()
        rows_b = db.scalars(
            select(WfAgentEventRow).where(
                WfAgentEventRow.owner_kind == owner_b.kind,
                WfAgentEventRow.owner_id == owner_b.id,
            )
        ).all()
        assert len(rows_a) == 1
        assert len(rows_b) == 1
        assert rows_a[0].event_type == "profile.context.changed"
        assert rows_a[0].entity_type == "profile"
        assert rows_a[0].status == "PENDING"
        assert rows_a[0].attempts == 0
        assert rows_a[0].schema_version == "1.5"


def test_worker_retry_schedule_and_dead_state(app):
    headers = account_headers(app, "retry_owner")
    actor = _account_actor(app, headers)
    owner = owner_for(actor)

    def _always_fail(db, ev_owner, ev_row):
        raise RuntimeError("transient_failure")

    register_consumer("test.failing.event", _always_fail, name="always_fail")
    try:
        t0 = datetime(2026, 10, 19, 12, 0, 0, tzinfo=UTC)
        with app.state.session_factory() as db:
            dispatch(
                db,
                actor,
                "test.failing.event",
                "ent-1",
                dedupe_key="test.failing.event:ent-1",
            )
            row = db.scalar(
                select(WfAgentEventRow).where(
                    WfAgentEventRow.owner_id == owner.id,
                    WfAgentEventRow.dedupe_key == "test.failing.event:ent-1",
                )
            )
            row.next_attempt_at = t0
            event_id = row.id
            db.commit()

        now = t0
        for expected_attempt, expected_delay in enumerate(RETRY_DELAYS[:4], start=1):
            processed = process_due(app.state.session_factory, now=now)
            assert processed >= 1
            with app.state.session_factory() as db:
                ev = db.get(WfAgentEventRow, event_id)
                assert ev.status == "FAILED"
                assert ev.attempts == expected_attempt
                next_at = (
                    ev.next_attempt_at
                    if ev.next_attempt_at.tzinfo
                    else ev.next_attempt_at.replace(tzinfo=UTC)
                )
                assert next_at == now + expected_delay
            # Not due before backoff expires
            assert (
                process_due(
                    app.state.session_factory, now=now + expected_delay - timedelta(seconds=1)
                )
                == 0
            )
            now = now + expected_delay

        # 5th attempt transitions to DEAD and records AGENT_EVENT_FAILED audit
        assert process_due(app.state.session_factory, now=now) >= 1
        with app.state.session_factory() as db:
            ev = db.get(WfAgentEventRow, event_id)
            assert ev.status == "DEAD"
            assert ev.attempts == 5
            assert ev.processed_at is not None
            audit_row = db.scalar(
                select(WfAuditLogRow).where(
                    WfAuditLogRow.owner_kind == owner.kind,
                    WfAuditLogRow.owner_id == owner.id,
                    WfAuditLogRow.event_type == "AGENT_EVENT_FAILED",
                )
            )
            assert audit_row is not None
            assert audit_row.result_status == "FAILED"
    finally:
        clear_consumers_for_test("test.failing.event")


def test_worker_cancels_when_consent_revoked_or_owner_gone(app, client):
    headers = account_headers(app, "cancel_consent")
    actor = _account_actor(app, headers)
    owner = owner_for(actor)

    # Grant and then revoke process_documents before worker runs
    grant(client, headers, "process_documents", True)
    with app.state.session_factory() as db:
        dispatch(
            db,
            actor,
            "document.field.confirmed",
            "doc-1",
            dedupe_key="document.field.confirmed:doc-1",
        )
        db.commit()
    grant(client, headers, "process_documents", False)

    process_due(app.state.session_factory, now=datetime.now(UTC) + timedelta(seconds=5))
    with app.state.session_factory() as db:
        ev = db.scalar(
            select(WfAgentEventRow).where(
                WfAgentEventRow.owner_id == owner.id,
                WfAgentEventRow.dedupe_key == "document.field.confirmed:doc-1",
            )
        )
        assert ev is not None
        assert ev.status == "CANCELLED"
        assert ev.error_code == "CONSENT_REVOKED"

    # Event for a non-existent owner is cancelled with OWNER_GONE
    ghost_owner = owner_for(Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=uuid4()))
    with app.state.session_factory() as db:
        assert db.get(AccountRow, ghost_owner.id) is None
        dispatch(
            db,
            ghost_owner,
            "profile.context.changed",
            str(ghost_owner.id),
            dedupe_key="ghost:1",
        )
        db.commit()

    process_due(app.state.session_factory, now=datetime.now(UTC) + timedelta(seconds=5))
    with app.state.session_factory() as db:
        ghost_ev = db.scalar(
            select(WfAgentEventRow).where(
                WfAgentEventRow.owner_id == ghost_owner.id,
                WfAgentEventRow.dedupe_key == "ghost:1",
            )
        )
        assert ghost_ev is not None
        assert ghost_ev.status == "CANCELLED"
        assert ghost_ev.error_code == "OWNER_GONE"
