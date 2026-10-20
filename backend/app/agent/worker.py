"""Transactional outbox worker and scheduled job runner.

Processes pending `wf_agent_events` rows using compare-and-set claiming,
deterministic exponential backoff (30s, 2m, 10m, 1h, 6h), DEAD terminal state
after 5 failed attempts with an `AGENT_EVENT_FAILED` audit entry, and
automatic cancellation when the owner is deleted/revoked or required consent is
revoked. Also dispatches due reminders and polls active sandbox claim follow-ups.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.database import make_engine, session_factory
from app.models import AccountRow, DemoSessionRow
from app.services.events import dispatch
from app.workflow import audit, followup
from app.workflow.models import WfAgentEventRow, WfReminderRow
from app.workflow.owner import ACCOUNT, DEMO, Owner, purpose_granted

RETRY_DELAYS: tuple[timedelta, ...] = (
    timedelta(seconds=30),
    timedelta(minutes=2),
    timedelta(minutes=10),
    timedelta(hours=1),
    timedelta(hours=6),
)
MAX_ATTEMPTS = len(RETRY_DELAYS)


@dataclass(frozen=True)
class ConsumerSpec:
    name: str
    handler: Callable[[Session, Owner, WfAgentEventRow], None]
    required_purposes: tuple[str, ...] = ()


_CONSUMERS: dict[str, list[ConsumerSpec]] = {}


def register_consumer(
    event_type: str,
    handler: Callable[[Session, Owner, WfAgentEventRow], None],
    *,
    name: str | None = None,
    required_purposes: tuple[str, ...] = (),
) -> None:
    """Register an idempotent consumer for a domain event type."""
    spec = ConsumerSpec(
        name=name or getattr(handler, "__name__", "consumer"),
        handler=handler,
        required_purposes=required_purposes,
    )
    bucket = _CONSUMERS.setdefault(event_type, [])
    if not any(existing.name == spec.name for existing in bucket):
        bucket.append(spec)


def clear_consumers_for_test(event_type: str | None = None) -> None:
    if event_type is None:
        _CONSUMERS.clear()
        _register_builtin_consumers()
    else:
        _CONSUMERS.pop(event_type, None)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def owner_is_active(db: Session, owner: Owner, now: datetime) -> bool:
    if owner.kind == ACCOUNT:
        return db.get(AccountRow, owner.id) is not None
    if owner.kind == DEMO:
        session = db.get(DemoSessionRow, owner.id)
        if session is None or session.revoked_at is not None:
            return False
        exp = _as_utc(session.expires_at)
        return exp is None or exp > now
    return False


def _handle_consent_revoked(db: Session, owner: Owner, event: WfAgentEventRow) -> None:
    """Cancel pending AI/document outbox jobs and scheduled reminders when consent is revoked."""
    now = datetime.now(UTC)
    if not purpose_granted(db, owner, "process_documents"):
        pending_rows = db.scalars(
            select(WfAgentEventRow).where(
                WfAgentEventRow.owner_kind == owner.kind,
                WfAgentEventRow.owner_id == owner.id,
                WfAgentEventRow.id != event.id,
                WfAgentEventRow.status.in_(("PENDING", "FAILED")),
            )
        ).all()
        for row in pending_rows:
            if (row.event_type or row.tool) != "consent.revoked":
                row.status = "CANCELLED"
                row.error_code = "CONSENT_REVOKED"
                row.processed_at = now
        reminders = db.scalars(
            select(WfReminderRow).where(
                WfReminderRow.owner_kind == owner.kind,
                WfReminderRow.owner_id == owner.id,
                WfReminderRow.status == "SCHEDULED",
            )
        ).all()
        for rem in reminders:
            rem.status = "CANCELLED"
            rem.cancelled_at = now
            rem.updated_at = now


def _handle_insights_and_schedules(db: Session, owner: Owner, event: WfAgentEventRow) -> None:
    """Refresh deterministic protection insights, protection review agent assessment, and policy reminders when context changes."""
    try:
        from app.agent.insights import refresh_owner_insights

        refresh_owner_insights(db, owner)
    except ImportError:
        pass
    try:
        from app.agent.protection_review import run_protection_review

        ev_type = event.event_type or event.tool or "EVENT_TRIGGER"
        run_protection_review(db, owner, trigger_reason=ev_type, force=True)
    except Exception:
        pass
    try:
        from app.agent.schedules import reconcile_owner_reminders

        reconcile_owner_reminders(db, owner)
    except ImportError:
        if purpose_granted(db, owner, "process_documents"):
            followup.sync_policy_reminders(db, owner)


def _handle_reminder_due(db: Session, owner: Owner, event: WfAgentEventRow) -> None:
    """Flow A consumer: when a policy expiry reminder is due, prepare the renewal action and refresh insights."""
    if purpose_granted(db, owner, "process_documents"):
        followup.prepare_proactive_renewal_actions(db, owner)
    _handle_insights_and_schedules(db, owner, event)


def _register_builtin_consumers() -> None:
    register_consumer(
        "consent.revoked",
        _handle_consent_revoked,
        name="cancel_on_consent_revoked",
        required_purposes=(),
    )
    register_consumer(
        "reminder.due",
        _handle_reminder_due,
        name="prepare_proactive_renewal_on_reminder",
        required_purposes=("process_documents",),
    )
    for ev in (
        "profile.context.changed",
        "onboarding.completed",
        "document.field.confirmed",
        "document.verified",
        "coverage.updated",
        "claim.created",
        "claim.status.changed",
        "action.prepared",
        "action.executed",
    ):
        purposes = (
            ("process_documents",) if ev.startswith(("document.", "coverage.", "claim.")) else ()
        )
        register_consumer(
            ev,
            _handle_insights_and_schedules,
            name="refresh_insights_and_schedules",
            required_purposes=purposes,
        )


_register_builtin_consumers()


def _claim_event(db: Session, event_id: UUID) -> bool:
    result = db.execute(
        update(WfAgentEventRow)
        .where(
            WfAgentEventRow.id == event_id,
            WfAgentEventRow.status.in_(("PENDING", "FAILED")),
        )
        .values(status="PROCESSING")
    )
    db.commit()
    return bool(result.rowcount)


def _process_single_event(factory: sessionmaker, event_id: UUID, now: datetime) -> bool:
    with factory() as db:
        if not _claim_event(db, event_id):
            return False
        row = db.get(WfAgentEventRow, event_id)
        if row is None:
            return False
        owner = Owner(row.owner_kind, row.owner_id)
        ev_type = row.event_type or row.tool

        if not owner_is_active(db, owner, now):
            row.status = "CANCELLED"
            row.error_code = "OWNER_GONE"
            row.processed_at = now
            db.commit()
            return True

        consumers = list(_CONSUMERS.get(ev_type, ()))
        for spec in consumers:
            for purpose in spec.required_purposes:
                if not purpose_granted(db, owner, purpose):
                    row.status = "CANCELLED"
                    row.error_code = "CONSENT_REVOKED"
                    row.processed_at = now
                    db.commit()
                    return True

        try:
            for spec in consumers:
                spec.handler(db, owner, row)
            row.status = "DONE"
            row.error_code = None
            row.processed_at = now
            db.commit()
            return True
        except Exception as exc:  # noqa: BLE001 - outbox worker captures failure into retry/DEAD state
            err_code = str(getattr(exc, "code", None) or exc.__class__.__name__.upper())[:60]
            db.rollback()

    with factory() as db:
        row = db.get(WfAgentEventRow, event_id)
        if row is None:
            return False
        owner = Owner(row.owner_kind, row.owner_id)
        row.attempts = int(row.attempts or 0) + 1
        row.error_code = err_code
        if row.attempts >= MAX_ATTEMPTS:
            row.status = "DEAD"
            row.processed_at = now
            row.next_attempt_at = None
            audit.record(
                db,
                owner,
                "AGENT_EVENT_FAILED",
                "SECURITY",
                "Background event failed after maximum retries",
                summary=f"Event {row.event_type or row.tool} exhausted {row.attempts} attempts.",
                actor_type="SYSTEM",
                tool=(row.event_type or row.tool)[:60],
                result_status="FAILED",
                reason=row.error_code,
                claim_id=row.claim_id,
                details={"error_code": row.error_code, "attempt": row.attempts},
            )
        else:
            delay = RETRY_DELAYS[row.attempts - 1]
            row.status = "FAILED"
            row.next_attempt_at = now + delay
        db.commit()
        return True


def _process_due_reminders(factory: sessionmaker, now: datetime, limit: int) -> int:
    today_iso = now.date().isoformat()
    with factory() as db:
        due_ids = db.scalars(
            select(WfReminderRow.id)
            .where(
                WfReminderRow.status == "SCHEDULED",
                WfReminderRow.cancelled_at.is_(None),
                or_(
                    WfReminderRow.fire_at <= now,
                    (WfReminderRow.fire_at.is_(None) & (WfReminderRow.due_date <= today_iso)),
                ),
            )
            .order_by(WfReminderRow.due_date.asc(), WfReminderRow.id.asc())
            .limit(limit)
        ).all()

    fired = 0
    for rem_id in due_ids:
        with factory() as db:
            rem = db.get(WfReminderRow, rem_id)
            if rem is None or rem.status != "SCHEDULED" or rem.cancelled_at is not None:
                continue
            owner = Owner(rem.owner_kind, rem.owner_id)
            if not owner_is_active(db, owner, now):
                rem.status = "CANCELLED"
                rem.cancelled_at = now
                rem.updated_at = now
                db.commit()
                continue
            if rem.kind == "POLICY_EXPIRY" and not purpose_granted(db, owner, "process_documents"):
                rem.status = "CANCELLED"
                rem.cancelled_at = now
                rem.updated_at = now
                db.commit()
                continue
            rem.status = "SENT"
            rem.updated_at = now
            dispatch(
                db,
                owner,
                "reminder.due",
                rem.policy_ref or str(rem.id),
                {"end_date": rem.due_date, "dedupe_part": str(rem.offset_days or 0)},
                dedupe_key=f"reminder.due:{rem.id}:{rem.due_date}",
                entity_type="reminder",
            )
            if rem.kind == "POLICY_EXPIRY":
                followup.prepare_proactive_renewal_actions(db, owner, today=now.date())
                try:
                    from app.agent.insights import refresh_owner_insights

                    refresh_owner_insights(db, owner, today=now.date())
                except ImportError:
                    pass
            db.commit()
            fired += 1
    return fired


def process_due(
    factory: sessionmaker,
    now: datetime | None = None,
    limit: int = 50,
) -> int:
    """Process due outbox events, due reminders, and due claim follow-up polls."""
    now = _as_utc(now) or datetime.now(UTC)
    processed = 0

    with factory() as db:
        due_event_ids = db.scalars(
            select(WfAgentEventRow.id)
            .where(
                WfAgentEventRow.status.in_(("PENDING", "FAILED")),
                or_(
                    WfAgentEventRow.next_attempt_at.is_(None),
                    WfAgentEventRow.next_attempt_at <= now,
                ),
            )
            .order_by(WfAgentEventRow.created_at.asc(), WfAgentEventRow.id.asc())
            .limit(limit)
        ).all()

    for event_id in due_event_ids:
        if _process_single_event(factory, event_id, now):
            processed += 1

    processed += _process_due_reminders(factory, now, limit)
    processed += followup.poll_due(factory, now=now)
    return processed


async def run_periodic_worker(
    factory: sessionmaker,
    interval_seconds: int,
    stop_event: asyncio.Event,
) -> None:
    step = max(1, int(interval_seconds))
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(process_due, factory)
        except Exception:  # noqa: BLE001 - periodic loop must not crash server lifespan
            pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=step)
        except TimeoutError:
            continue


def main() -> None:
    settings = get_settings()
    engine = make_engine(settings.database_url)
    factory = session_factory(engine)
    try:
        count = process_due(factory)
        print(f"Processed {count} due items.")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
