"""Backend-only audit and agent-event writer.

No route accepts audit input from a client. Details pass through an allow-list so raw documents,
free text, names, secrets and complete policy identifiers cannot enter the log.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.workflow.models import WfAgentEventRow, WfAuditLogRow
from app.workflow.owner import Owner

CATEGORIES = ("DOCUMENTS", "COVERAGE", "CLAIMS", "ACTIONS", "SECURITY")
ACTORS = ("USER", "AI_PREPARED", "BACKEND_EXECUTED", "SANDBOX", "SYSTEM")

_ALLOWED_SCALARS = {
    "claim_reference",
    "claim_type",
    "action_type",
    "action_reference",
    "amount",
    "currency",
    "service_date",
    "provider",
    "document_count",
    "document_kind",
    "size_bytes",
    "environment",
    "destination",
    "error_code",
    "status",
    "from_status",
    "to_status",
    "country_code",
    "sandbox_reference",
    "payload_digest",
    "attempt",
    "reason_code",
    "permission",
    "flag_category",
    "check_status",
}
_ALLOWED_LISTS = {"check_codes", "missing_items", "flag_ids", "permissions", "changed_fields"}


def safe_details(details: dict | None) -> dict:
    output: dict = {}
    for key, value in (details or {}).items():
        if key in _ALLOWED_SCALARS and isinstance(value, str | int | float | bool):
            output[key] = value[:120] if isinstance(value, str) else value
        elif key in _ALLOWED_LISTS and isinstance(value, list | tuple):
            output[key] = [str(item)[:60] for item in value[:30]]
    return output


def record(
    db: Session,
    owner: Owner,
    event_type: str,
    category: str,
    title: str,
    *,
    summary: str | None = None,
    actor_type: str = "SYSTEM",
    tool: str | None = None,
    result_status: str = "SUCCESS",
    reason: str | None = None,
    claim_id: UUID | None = None,
    action_id: UUID | None = None,
    receipt_ref: str | None = None,
    evidence_refs: list[str] | None = None,
    details: dict | None = None,
) -> WfAuditLogRow:
    assert category in CATEGORIES and actor_type in ACTORS
    row = WfAuditLogRow(
        owner_kind=owner.kind,
        owner_id=owner.id,
        event_type=event_type,
        category=category,
        title=title[:200],
        summary=(summary or "")[:500] or None,
        actor_type=actor_type,
        tool=tool,
        result_status=result_status,
        reason=(reason or "")[:300] or None,
        claim_id=claim_id,
        action_id=action_id,
        receipt_ref=receipt_ref,
        evidence_refs=[str(ref)[:80] for ref in (evidence_refs or [])[:10]],
        details=safe_details(details),
        created_at=datetime.now(UTC),
    )
    db.add(row)
    db.flush()
    return row


def agent_event(
    db: Session,
    owner: Owner,
    tool: str,
    outcome: str = "OK",
    claim_id: UUID | None = None,
    detail: dict | None = None,
) -> None:
    db.add(
        WfAgentEventRow(
            owner_kind=owner.kind,
            owner_id=owner.id,
            tool=tool,
            outcome=outcome,
            claim_id=claim_id,
            detail=safe_details(detail),
        )
    )


def query_events(
    db: Session,
    owner: Owner,
    *,
    category: str | None = None,
    q: str | None = None,
    claim_id: UUID | None = None,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[WfAuditLogRow], int]:
    clauses = [WfAuditLogRow.owner_kind == owner.kind, WfAuditLogRow.owner_id == owner.id]
    if category:
        clauses.append(WfAuditLogRow.category == category)
    if claim_id:
        clauses.append(WfAuditLogRow.claim_id == claim_id)
    if status:
        clauses.append(WfAuditLogRow.result_status == status)
    if q:
        like = f"%{q.casefold()}%"
        clauses.append(
            or_(
                func.lower(WfAuditLogRow.title).like(like),
                func.lower(func.coalesce(WfAuditLogRow.summary, "")).like(like),
                func.lower(WfAuditLogRow.event_type).like(like),
            )
        )
    if date_from:
        clauses.append(
            WfAuditLogRow.created_at >= datetime.fromisoformat(date_from).replace(tzinfo=UTC)
        )
    if date_to:
        end = datetime.fromisoformat(date_to).replace(tzinfo=UTC)
        clauses.append(WfAuditLogRow.created_at < end.replace(hour=23, minute=59, second=59))
    where = and_(*clauses)
    total = db.scalar(select(func.count()).select_from(WfAuditLogRow).where(where)) or 0
    rows = db.scalars(
        select(WfAuditLogRow)
        .where(where)
        .order_by(WfAuditLogRow.created_at.desc(), WfAuditLogRow.id)
        .limit(limit)
        .offset(offset)
    )
    return list(rows), total
