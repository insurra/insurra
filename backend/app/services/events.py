"""In-process event dispatcher.

`dispatch` runs inside the producing transaction. It records an agent event (allow-listed
metadata only) and maps the event to zero or one notification through the static template
table. Duplicate events collapse through the notification dedupe key and never raise.
"""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.actor_scope import owner_kind_id
from app.services.notifications import TEMPLATES, emit_outcome
from app.workflow import audit
from app.workflow.owner import Owner, owner_policies

EVENT_TYPES = (
    "profile.context.changed",
    "onboarding.completed",
    "document.uploaded",
    "document.extraction.completed",
    "document.extraction.failed",
    "document.review.required",
    "document.field.confirmed",
    "coverage.updated",
    "coverage.assessment.completed",
    "policy.changed",
    "policy.renewal.check",
    "claim.created",
    "claim.status.changed",
    "action.prepared",
    "action.approved",
    "action.executed",
    "reminder.due",
    "consent.revoked",
)
REMINDER_WINDOW_DAYS = 30


def _route(event_type: str, ref: str, meta: dict) -> tuple[str | None, str | None]:
    """Returns (template key, dedupe key). Both None when the event has no notification."""
    part = str(meta.get("dedupe_part", ""))
    if meta.get("notify") is False:
        return None, None
    if event_type in (
        "onboarding.completed",
        "document.extraction.completed",
        "document.extraction.failed",
        "document.review.required",
        "claim.created",
    ):
        return event_type, f"{event_type}:{ref}"
    if event_type == "claim.status.changed":
        template = f"claim.status.{meta.get('to_status')}"
        if template in TEMPLATES:
            return template, f"claim.status:{ref}:{meta.get('to_status')}:{part}"
        return None, None
    if event_type == "action.prepared":
        if meta.get("status") == "AWAITING_APPROVAL":
            return event_type, f"action.prepared:{ref}:{part}"
        return None, None
    if event_type in ("action.approved", "action.executed", "consent.revoked"):
        return event_type, f"{event_type}:{ref}:{part}"
    if event_type == "reminder.due":
        return event_type, f"reminder:{ref}:{meta.get('end_date')}"
    return None, None


def dispatch(
    db: Session,
    actor,
    event_type: str,
    entity_ref: str | UUID | None = None,
    meta: dict | None = None,
    *,
    entity_id: str | UUID | None = None,
    dedupe_key: str | None = None,
    entity_type: str | None = None,
) -> str | None:
    """Record the event and create at most one notification. Returns the outcome or None."""
    meta = dict(meta or {})
    ref = str(entity_ref if entity_ref is not None else (entity_id or ""))
    template, dedupe = _route(event_type, ref, meta)
    if dedupe_key:
        outbox_dedupe = str(dedupe_key)[:140]
    elif meta.get("dedupe_key"):
        outbox_dedupe = str(meta["dedupe_key"])[:140]
    elif dedupe:
        outbox_dedupe = dedupe[:140]
    else:
        suffix = (
            meta.get("dedupe_part")
            or meta.get("to_status")
            or meta.get("status")
            or meta.get("end_date")
            or ""
        )
        outbox_dedupe = f"{event_type}:{ref}:{suffix}".rstrip(":")[:140]

    ent_type = (entity_type or event_type.split(".")[0])[:40]
    outcome = None
    if template and dedupe:
        outcome, _ = emit_outcome(
            db,
            actor,
            template,
            entity_id=ref,
            dedupe_key=outbox_dedupe if dedupe_key else dedupe,
            event_source=event_type,
        )
    # Reminders are derived on every read, so only a real creation is recorded.
    record = outcome == "created" if event_type == "reminder.due" else outcome != "duplicate"
    if record:
        kind, owner_id = owner_kind_id(actor)
        claim_id = None
        if event_type.startswith("claim."):
            try:
                claim_id = UUID(ref)
            except ValueError:
                claim_id = None
        audit.agent_event(
            db,
            Owner(kind, owner_id),
            event_type[:60],
            "OK",
            claim_id,
            meta,
            event_type=event_type[:60],
            entity_type=ent_type,
            entity_id=ref[:80],
            dedupe_key=outbox_dedupe,
            status="PENDING",
        )
    return outcome


def _date(value: object) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def sync_reminders(db: Session, actor, today: date | None = None) -> int:
    """Deterministic coverage-end reminders, derived on read. Returns newly created count."""
    today = today or datetime.now(UTC).date()
    kind, owner_id = owner_kind_id(actor)
    created = 0
    for policy in owner_policies(db, Owner(kind, owner_id)):
        end = _date(policy.end)
        if end is None or not today <= end <= today + timedelta(days=REMINDER_WINDOW_DAYS):
            continue
        outcome = dispatch(db, actor, "reminder.due", policy.ref, {"end_date": end.isoformat()})
        created += outcome == "created"
    return created
