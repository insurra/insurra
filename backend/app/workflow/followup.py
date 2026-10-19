"""Closed-loop claim follow-up and deterministic policy reminders."""

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.errors import AppError
from app.services.events import dispatch
from app.workflow import actions, audit, kbdata, sandbox, states
from app.workflow.models import WfClaimCaseRow, WfReminderRow
from app.workflow.owner import Owner, owner_policies, purpose_granted

STATUS_MAP = {
    sandbox.SUBMITTED: states.SUBMITTED,
    sandbox.PROCESSING: states.PROCESSING,
    sandbox.ADDITIONAL_INFO: states.ADDITIONAL_INFO,
    sandbox.APPROVED: states.APPROVED_SANDBOX,
    sandbox.REJECTED: states.REJECTED_SANDBOX,
}
_ORDER = [states.SUBMITTED, states.PROCESSING]
FINAL = (states.APPROVED_SANDBOX, states.REJECTED_SANDBOX)
BACKOFF_CAP_SECONDS = 600


def _now() -> datetime:
    return datetime.now(UTC)


def stop_monitoring(
    db: Session, owner: Owner, case: WfClaimCaseRow, state: str, reason: str
) -> None:
    if case.monitoring_state == state:
        return
    case.monitoring_state = state
    case.next_poll_at = None
    audit.record(
        db,
        owner,
        "CLAIM_MONITORING_STOPPED",
        "CLAIMS",
        "Claim monitoring stopped",
        summary=f"Status monitoring for {case.reference} stopped.",
        actor_type="SYSTEM",
        claim_id=case.id,
        reason=reason,
        details={"claim_reference": case.reference, "reason_code": reason},
    )


def set_monitoring(db: Session, owner: Owner, case: WfClaimCaseRow, enabled: bool) -> None:
    case.monitoring_enabled = enabled
    if not case.sandbox_ref or case.status in FINAL:
        return
    if enabled:
        case.monitoring_state = "ACTIVE"
        case.next_poll_at = _now() + timedelta(seconds=max(1, get_settings().sandbox_step_seconds))
        case.poll_attempts = 0
        audit.record(
            db,
            owner,
            "CLAIM_MONITORING_STARTED",
            "CLAIMS",
            "Claim monitoring enabled",
            summary=f"Status monitoring for {case.reference} was enabled.",
            actor_type="USER",
            claim_id=case.id,
            details={"claim_reference": case.reference},
        )
    else:
        stop_monitoring(db, owner, case, "DISABLED", "DISABLED_BY_USER")


def prepare_follow_up(db: Session, owner: Owner, case: WfClaimCaseRow, missing: list[str]) -> None:
    """Missing evidence becomes an actionable task and an unsent draft that needs approval."""
    kinds = ", ".join(k.replace("_", " ").lower() for k in missing) or "supporting documents"
    key = f"missing:{case.id}:{case.sandbox_ref}:{','.join(sorted(missing))}"
    if not db.scalar(
        select(WfReminderRow).where(
            WfReminderRow.owner_kind == owner.kind,
            WfReminderRow.owner_id == owner.id,
            WfReminderRow.dedupe_key == key,
        )
    ):
        db.add(
            WfReminderRow(
                owner_kind=owner.kind,
                owner_id=owner.id,
                kind="CLAIM_TASK",
                title=f"Provide missing evidence for {case.reference}",
                detail=f"The sandbox asked for: {kinds}.",
                claim_id=case.id,
                due_date=date.today().isoformat(),
                dedupe_key=key,
                evidence_status="SANDBOX_REQUEST",
            )
        )
    procedure = kbdata.procedure_for_product(case.country_code, case.product_id) or {}
    contact = procedure.get("customer_support_contact")
    body = (
        f"Hello,\n\nI am following up on claim reference {case.sandbox_ref} "
        f"(case {case.reference}). The review asked for additional documents: {kinds}.\n"
        "I will provide them. Please confirm how and where to send them and whether the "
        "filing deadline remains unchanged.\n\nThank you."
    )
    actions.prepare_action(
        db,
        owner,
        "claim_follow_up_message",
        title="Send follow-up message to insurer",
        purpose="Draft a message about the additional documents the sandbox requested.",
        payload={
            "subject": f"Additional documents for claim {case.sandbox_ref}",
            "body": body,
            "recipient_note": contact
            or "No verified contact found. Use the insurer's official channel.",
            "claim_reference": case.reference,
            "missing_items": sorted(missing),
        },
        claim=case,
        dedupe_base=f"follow_up:{case.id}:{case.sandbox_ref}",
    )


def sync_claim(
    db: Session,
    owner: Owner,
    case: WfClaimCaseRow,
    *,
    manual: bool = False,
    now: datetime | None = None,
) -> dict:
    now = now or _now()
    if not case.sandbox_ref:
        raise AppError(409, "NOT_SUBMITTED", "This claim has not been submitted to the sandbox.")
    result = {"changed": False, "status": case.status, "monitoring_state": case.monitoring_state}
    if case.status in FINAL:
        stop_monitoring(db, owner, case, "COMPLETED", "FINAL_STATUS")
        return {**result, "monitoring_state": case.monitoring_state}
    if not purpose_granted(db, owner, "process_documents"):
        stop_monitoring(db, owner, case, "STOPPED_CONSENT_REVOKED", "CONSENT_REVOKED")
        return {**result, "monitoring_state": case.monitoring_state}
    if not manual:
        if not case.monitoring_enabled:
            return result
        if case.poll_attempts >= get_settings().claim_poll_limit:
            stop_monitoring(db, owner, case, "POLL_LIMIT_REACHED", "POLL_LIMIT")
            return {**result, "monitoring_state": case.monitoring_state}
    try:
        row = sandbox.get_owned(db, owner, case.sandbox_ref)
        sandbox.advance(db, row, now)
    except Exception:  # noqa: BLE001 - any read failure uses bounded retry with backoff
        case.poll_failures += 1
        delay = min(BACKOFF_CAP_SECONDS, 2 ** min(case.poll_failures, 9) * 5)
        case.next_poll_at = now + timedelta(seconds=delay)
        audit.record(
            db,
            owner,
            "SANDBOX_STATUS_CHECK_FAILED",
            "CLAIMS",
            "Sandbox status check failed",
            actor_type="SYSTEM",
            tool="get_sandbox_claim_status",
            result_status="FAILED",
            claim_id=case.id,
            details={"claim_reference": case.reference, "attempt": case.poll_failures},
        )
        return {**result, "error": "STATUS_CHECK_FAILED"}
    case.poll_failures = 0
    case.poll_attempts += 1
    case.last_checked_at = now
    target = STATUS_MAP[row.status]
    changed = False
    if case.sandbox_status != row.status:
        start_idx = (_ORDER.index(case.status) + 1) if case.status in _ORDER else 0
        end_idx = _ORDER.index(target) if target in _ORDER else len(_ORDER)
        path = [s for s in _ORDER[start_idx:end_idx] if s != target]
        for step in [*path, target]:
            if case.status == step:
                continue
            moved = states.transition(
                db,
                case,
                step,
                source="SANDBOX",
                event_type="SANDBOX_STATUS_CHANGED",
                dedupe_key=f"{case.sandbox_ref}:{row.payload_digest[:8]}:{step}",
                note=row.decision_reason if step == target else None,
            )
            changed = changed or moved
        case.sandbox_status = row.status
        if changed:
            dispatch(
                db,
                owner,
                "claim.status.changed",
                case.id,
                {"to_status": target, "dedupe_part": row.payload_digest[:8]},
            )
            audit.record(
                db,
                owner,
                "SANDBOX_STATUS_CHANGED",
                "CLAIMS",
                "Sandbox claim status changed",
                summary=f"{case.reference} is now '{states.LABELS[target]}' in the sandbox. This is not a real insurer decision.",
                actor_type="SANDBOX",
                tool="get_sandbox_claim_status",
                claim_id=case.id,
                details={
                    "claim_reference": case.reference,
                    "to_status": target,
                    "sandbox_reference": case.sandbox_ref,
                    "environment": "SANDBOX",
                },
            )
        if target == states.ADDITIONAL_INFO:
            prepare_follow_up(db, owner, case, row.missing_items or [])
    if case.status in FINAL:
        case.monitoring_state, case.next_poll_at = "COMPLETED", None
    elif case.monitoring_enabled:
        case.next_poll_at = now + timedelta(seconds=max(1, get_settings().sandbox_step_seconds))
    return {"changed": changed, "status": case.status, "monitoring_state": case.monitoring_state}


def poll_due(factory: sessionmaker, now: datetime | None = None) -> int:
    """Scheduled polling fallback. One claim per transaction so failures stay isolated."""
    now = now or _now()
    synced = 0
    with factory() as db:
        due = db.scalars(
            select(WfClaimCaseRow.id).where(
                WfClaimCaseRow.monitoring_state == "ACTIVE",
                WfClaimCaseRow.monitoring_enabled.is_(True),
                WfClaimCaseRow.next_poll_at.is_not(None),
                WfClaimCaseRow.next_poll_at <= now,
            )
        ).all()
    for case_id in due:
        with factory() as db:
            case = db.get(WfClaimCaseRow, case_id)
            if case is None:
                continue
            owner = Owner(case.owner_kind, case.owner_id)
            sync_claim(db, owner, case, now=now)
            db.commit()
            synced += 1
    return synced


# ----- reminders ----------------------------------------------------------------------------


def _parse(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def sync_policy_reminders(
    db: Session, owner: Owner, offsets: tuple[int, ...] = (30, 7, 1), today: date | None = None
) -> dict:
    today = today or date.today()
    existing = list(
        db.scalars(
            select(WfReminderRow).where(
                WfReminderRow.owner_kind == owner.kind,
                WfReminderRow.owner_id == owner.id,
                WfReminderRow.kind == "POLICY_EXPIRY",
                WfReminderRow.status == "SCHEDULED",
            )
        )
    )
    if not purpose_granted(db, owner, "process_documents"):
        for row in existing:
            row.status, row.updated_at = "CANCELLED", _now()
        return {"scheduled": 0, "cancelled": len(existing), "state": "CONSENT_REQUIRED"}
    desired: dict[str, dict] = {}
    for policy in owner_policies(db, owner):
        end = _parse(policy.end)
        if end is None or end < today:
            continue
        label = policy.name or policy.provider or policy.kind
        for offset in sorted({o for o in offsets if 0 < o <= 365}, reverse=True):
            due = end - timedelta(days=offset)
            if due < today:
                continue
            key = f"policy:{policy.ref}:{end.isoformat()}:{offset}"
            desired[key] = {
                "policy_ref": policy.ref,
                "offset": offset,
                "due": due.isoformat(),
                "title": f"{label} ends in {offset} day{'s' if offset > 1 else ''}",
                "detail": (
                    f"Recorded end date {end.isoformat()}. Renewal and grace period terms are not "
                    "verified, so this is a reminder, not a lapse notice."
                ),
                "evidence": policy.verification,
            }
    created = 0
    for key, item in desired.items():
        row = next((r for r in existing if r.dedupe_key == key), None)
        if row is None:
            clash = db.scalar(
                select(WfReminderRow).where(
                    WfReminderRow.owner_kind == owner.kind,
                    WfReminderRow.owner_id == owner.id,
                    WfReminderRow.dedupe_key == key,
                )
            )
            if (
                clash is not None
            ):  # a cancelled one for the same date stays cancelled unless dates return
                if clash.status == "CANCELLED":
                    clash.status, clash.updated_at = "SCHEDULED", _now()
                    created += 1
                continue
            db.add(
                WfReminderRow(
                    owner_kind=owner.kind,
                    owner_id=owner.id,
                    kind="POLICY_EXPIRY",
                    title=item["title"],
                    detail=item["detail"],
                    policy_ref=item["policy_ref"],
                    offset_days=item["offset"],
                    due_date=item["due"],
                    dedupe_key=key,
                    evidence_status=item["evidence"],
                )
            )
            created += 1
    cancelled = 0
    for row in existing:
        if row.dedupe_key not in desired:
            row.status, row.updated_at = "CANCELLED", _now()
            cancelled += 1
    if created or cancelled:
        audit.record(
            db,
            owner,
            "REMINDERS_SCHEDULED",
            "COVERAGE",
            "Policy reminders updated",
            summary=f"{created} reminder(s) scheduled and {cancelled} cancelled after a deterministic date check.",
            actor_type="SYSTEM",
            tool="schedule_policy_reminder",
            details={"document_count": created, "attempt": cancelled},
        )
    return {"scheduled": created, "cancelled": cancelled, "state": "OK"}


def prepare_proactive_renewal_actions(
    db: Session,
    owner: Owner,
    *,
    today: date | None = None,
    window_days: int = 30,
) -> list:
    """Flow A: Detect policies expiring within window_days (or recently lapsed) and idempotently prepare renewal actions."""
    today = today or date.today()
    if not purpose_granted(db, owner, "process_documents"):
        return []
    prepared = []
    for policy in owner_policies(db, owner):
        end = _parse(policy.end)
        if end is None:
            continue
        days_remaining = (end - today).days
        if -7 <= days_remaining <= window_days:
            dedupe = f"proactive_renewal:{policy.ref}:{end.isoformat()}"
            action = actions.prepare_user_action(
                db,
                owner,
                "renewal_inquiry",
                entity_type="coverage",
                entity_id=policy.ref,
                dedupe_key=dedupe,
            )
            prepared.append(action)
    return prepared


def cancel_policy_reminders(db: Session, owner: Owner, policy_ref: str, reason: str) -> int:
    rows = list(
        db.scalars(
            select(WfReminderRow).where(
                WfReminderRow.owner_kind == owner.kind,
                WfReminderRow.owner_id == owner.id,
                WfReminderRow.policy_ref == policy_ref,
                WfReminderRow.status == "SCHEDULED",
            )
        )
    )
    for row in rows:
        row.status, row.updated_at = "CANCELLED", _now()
    if rows:
        audit.record(
            db,
            owner,
            "REMINDERS_CANCELLED",
            "COVERAGE",
            "Policy reminders cancelled",
            summary="Pending reminders for this policy were cancelled.",
            actor_type="USER",
            tool="cancel_policy_reminder",
            reason=reason,
            details={"document_count": len(rows), "reason_code": reason},
        )
    return len(rows)


def reminder_view(row: WfReminderRow, today: date | None = None) -> dict:
    today = today or date.today()
    due = _parse(row.due_date)
    return {
        "id": row.id,
        "kind": row.kind,
        "title": row.title,
        "detail": row.detail,
        "policy_ref": row.policy_ref,
        "claim_id": row.claim_id,
        "offset_days": row.offset_days,
        "due_date": row.due_date,
        "status": row.status,
        "is_due": bool(row.status == "SCHEDULED" and due and due <= today),
        "evidence_status": row.evidence_status,
    }
