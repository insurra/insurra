"""Claim state machine. Status changes happen only through transition() or derived recompute."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.workflow.models import WfClaimCaseRow, WfClaimStatusEventRow

DRAFT = "DRAFT"
MISSING_EVIDENCE = "MISSING_EVIDENCE"
NEEDS_REVIEW = "NEEDS_REVIEW"
READY_FOR_APPROVAL = "READY_FOR_APPROVAL"
AWAITING_APPROVAL = "AWAITING_APPROVAL"
SUBMITTED = "SUBMITTED_TO_SANDBOX"
PROCESSING = "PROCESSING_IN_SANDBOX"
ADDITIONAL_INFO = "ADDITIONAL_INFO_REQUIRED"
APPROVED_SANDBOX = "APPROVED_IN_SANDBOX"
REJECTED_SANDBOX = "REJECTED_IN_SANDBOX"
CANCELLED = "CANCELLED"

PRE_SUBMISSION = (DRAFT, MISSING_EVIDENCE, NEEDS_REVIEW, READY_FOR_APPROVAL)
POST_SUBMISSION = (SUBMITTED, PROCESSING, ADDITIONAL_INFO, APPROVED_SANDBOX, REJECTED_SANDBOX)
TERMINAL = (APPROVED_SANDBOX, REJECTED_SANDBOX, CANCELLED)

LABELS = {
    DRAFT: "Draft",
    MISSING_EVIDENCE: "Missing Evidence",
    NEEDS_REVIEW: "Needs Review",
    READY_FOR_APPROVAL: "Ready for Approval",
    AWAITING_APPROVAL: "Awaiting Approval",
    SUBMITTED: "Submitted to Sandbox",
    PROCESSING: "Processing in Sandbox",
    ADDITIONAL_INFO: "Additional Information Required",
    APPROVED_SANDBOX: "Approved in Sandbox",
    REJECTED_SANDBOX: "Rejected in Sandbox",
    CANCELLED: "Cancelled",
}

_PRE = set(PRE_SUBMISSION)
ALLOWED: dict[str, set[str]] = {
    DRAFT: _PRE | {CANCELLED},
    MISSING_EVIDENCE: _PRE | {CANCELLED},
    NEEDS_REVIEW: _PRE | {CANCELLED},
    READY_FOR_APPROVAL: _PRE | {AWAITING_APPROVAL, CANCELLED},
    AWAITING_APPROVAL: _PRE | {SUBMITTED, CANCELLED},
    SUBMITTED: {PROCESSING},
    PROCESSING: {ADDITIONAL_INFO, APPROVED_SANDBOX, REJECTED_SANDBOX},
    ADDITIONAL_INFO: {NEEDS_REVIEW, MISSING_EVIDENCE, READY_FOR_APPROVAL, CANCELLED},
    APPROVED_SANDBOX: set(),
    REJECTED_SANDBOX: set(),
    CANCELLED: set(),
}


def add_event(
    db: Session,
    case: WfClaimCaseRow,
    event_type: str,
    *,
    from_status: str | None = None,
    to_status: str | None = None,
    source: str = "SYSTEM",
    note: str | None = None,
    dedupe_key: str | None = None,
) -> WfClaimStatusEventRow | None:
    if dedupe_key:
        existing = (
            db.query(WfClaimStatusEventRow)
            .filter_by(claim_id=case.id, dedupe_key=dedupe_key)
            .first()
        )
        if existing is not None:
            return None
    event = WfClaimStatusEventRow(
        claim_id=case.id,
        event_type=event_type,
        from_status=from_status,
        to_status=to_status,
        source=source,
        note=(note or "")[:300] or None,
        dedupe_key=dedupe_key,
        created_at=datetime.now(UTC),
    )
    db.add(event)
    db.flush()
    return event


def transition(
    db: Session,
    case: WfClaimCaseRow,
    new_status: str,
    *,
    source: str = "SYSTEM",
    note: str | None = None,
    dedupe_key: str | None = None,
    event_type: str = "STATUS_CHANGED",
) -> bool:
    """Apply a valid transition. Returns False when it was a no-op or a duplicate event."""
    if case.status == new_status:
        return False
    if new_status not in ALLOWED.get(case.status, set()):
        raise AppError(
            409,
            "INVALID_STATE_TRANSITION",
            "This claim cannot move to that state from its current state.",
            {"from_status": case.status, "to_status": new_status},
        )
    if dedupe_key:
        existing = (
            db.query(WfClaimStatusEventRow)
            .filter_by(claim_id=case.id, dedupe_key=dedupe_key)
            .first()
        )
        if existing is not None:
            return False
    previous = case.status
    case.status = new_status
    case.updated_at = datetime.now(UTC)
    add_event(
        db,
        case,
        event_type,
        from_status=previous,
        to_status=new_status,
        source=source,
        note=note,
        dedupe_key=dedupe_key,
    )
    return True
