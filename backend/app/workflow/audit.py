"""Backend-only audit and agent-event writer.

No route accepts audit input from a client. Details pass through an allow-list so raw documents,
free text, names, secrets and complete policy identifiers cannot enter the log.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
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
    *,
    event_type: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    dedupe_key: str | None = None,
    status: str = "PENDING",
    next_attempt_at: datetime | None = None,
) -> WfAgentEventRow:
    now = datetime.now(UTC)
    clean_dedupe = dedupe_key[:140] if dedupe_key else None
    if clean_dedupe:
        existing = db.scalar(
            select(WfAgentEventRow).where(
                WfAgentEventRow.owner_kind == owner.kind,
                WfAgentEventRow.owner_id == owner.id,
                WfAgentEventRow.dedupe_key == clean_dedupe,
            )
        )
        if existing is not None:
            return existing
    row = WfAgentEventRow(
        owner_kind=owner.kind,
        owner_id=owner.id,
        tool=tool[:60],
        event_type=(event_type or tool)[:60],
        entity_type=entity_type[:40] if entity_type else None,
        entity_id=entity_id[:80] if entity_id else None,
        dedupe_key=clean_dedupe,
        status=status,
        attempts=0,
        next_attempt_at=next_attempt_at or now,
        schema_version="1.5",
        outcome=outcome,
        claim_id=claim_id,
        detail=safe_details(detail),
        created_at=now,
    )
    db.add(row)
    db.flush()
    return row


@dataclass
class AuditTimelineEntry:
    id: UUID
    event_type: str
    category: str
    title: str
    summary: str | None
    actor_type: str
    tool: str | None
    result_status: str
    reason: str | None
    claim_id: UUID | None
    action_id: UUID | None
    receipt_ref: str | None
    evidence_refs: list[str] = field(default_factory=list)
    details: dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    synthetic: bool = False
    source_table: str = "wf_audit_logs"


def _ensure_utc(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime.now(UTC)
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def _infer_category(event_type: str) -> str:
    upper = (event_type or "").upper()
    if any(k in upper for k in ("DOC", "EXTRACT", "FIELD", "POLICY_UPLOAD")):
        return "DOCUMENTS"
    if any(k in upper for k in ("CLAIM", "SANDBOX", "PATHWAY")):
        return "CLAIMS"
    if any(k in upper for k in ("ACTION", "APPROV", "EXEC", "SERVICING")):
        return "ACTIONS"
    if any(k in upper for k in ("CONSENT", "AUTH", "LOGIN", "DELETE", "PRIVACY", "SECURITY")):
        return "SECURITY"
    return "COVERAGE"


def _human_title(event_type: str) -> str:
    cleaned = (event_type or "EVENT").replace("_", " ").replace(".", " ").strip()
    return cleaned.capitalize()[:200]


def _from_wf_row(row: WfAuditLogRow, synthetic: bool) -> AuditTimelineEntry:
    return AuditTimelineEntry(
        id=row.id,
        event_type=row.event_type,
        category=row.category,
        title=row.title,
        summary=row.summary,
        actor_type=row.actor_type,
        tool=row.tool,
        result_status=row.result_status,
        reason=row.reason,
        claim_id=row.claim_id,
        action_id=row.action_id,
        receipt_ref=row.receipt_ref,
        evidence_refs=list(row.evidence_refs or []),
        details=safe_details(row.details),
        created_at=_ensure_utc(row.created_at),
        synthetic=synthetic,
        source_table="wf_audit_logs",
    )


def _from_demo_audit_row(row, synthetic: bool) -> AuditTimelineEntry:
    meta = row.event_metadata if isinstance(row.event_metadata, dict) else {}
    return AuditTimelineEntry(
        id=row.id,
        event_type=row.event_type,
        category=_infer_category(row.event_type),
        title=_human_title(row.event_type),
        summary=f"Recorded workspace event ({row.outcome}).",
        actor_type="USER" if "USER" in row.event_type.upper() else "SYSTEM",
        tool=None,
        result_status="SUCCESS" if row.outcome in ("OK", "SUCCESS", "ALLOWED") else row.outcome,
        reason=None,
        claim_id=None,
        action_id=None,
        receipt_ref=None,
        evidence_refs=[],
        details=safe_details(meta),
        created_at=_ensure_utc(row.created_at),
        synthetic=synthetic,
        source_table="audit_events",
    )


def _from_account_audit_row(row) -> AuditTimelineEntry:
    meta = row.metadata_json if isinstance(row.metadata_json, dict) else {}
    return AuditTimelineEntry(
        id=row.id,
        event_type=row.event_type,
        category=_infer_category(row.event_type),
        title=_human_title(row.event_type),
        summary="Recorded account audit event.",
        actor_type="USER",
        tool=None,
        result_status="SUCCESS",
        reason=None,
        claim_id=None,
        action_id=None,
        receipt_ref=None,
        evidence_refs=[],
        details=safe_details(meta),
        created_at=_ensure_utc(row.created_at),
        synthetic=False,
        source_table="account_audit_events",
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
) -> tuple[list[AuditTimelineEntry], int]:
    from app.models.account_data import AccountAuditRow
    from app.models.entities import AuditRow

    is_synthetic = owner.kind == "DEMO"
    entries: list[AuditTimelineEntry] = []

    wf_rows = db.scalars(
        select(WfAuditLogRow).where(
            WfAuditLogRow.owner_kind == owner.kind,
            WfAuditLogRow.owner_id == owner.id,
        )
    ).all()
    entries.extend(_from_wf_row(r, is_synthetic) for r in wf_rows)

    if owner.kind == "DEMO":
        demo_rows = db.scalars(select(AuditRow).where(AuditRow.session_id == owner.id)).all()
        entries.extend(_from_demo_audit_row(r, True) for r in demo_rows)
    elif owner.kind == "ACCOUNT":
        acct_rows = db.scalars(
            select(AccountAuditRow).where(AccountAuditRow.account_id == owner.id)
        ).all()
        entries.extend(_from_account_audit_row(r) for r in acct_rows)

    if category:
        entries = [e for e in entries if e.category == category]
    if claim_id:
        entries = [e for e in entries if e.claim_id == claim_id]
    if status:
        entries = [e for e in entries if e.result_status == status]
    if q:
        term = q.casefold()
        entries = [
            e
            for e in entries
            if term in (e.title or "").casefold()
            or term in (e.summary or "").casefold()
            or term in (e.event_type or "").casefold()
        ]
    if date_from:
        start_dt = datetime.fromisoformat(date_from).replace(tzinfo=UTC)
        entries = [e for e in entries if e.created_at >= start_dt]
    if date_to:
        end_dt = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59, tzinfo=UTC)
        entries = [e for e in entries if e.created_at <= end_dt]

    entries.sort(key=lambda e: (e.created_at, str(e.id)), reverse=True)
    total = len(entries)
    sliced = entries[offset : offset + limit]
    return sliced, total


def get_event_by_id(db: Session, owner: Owner, event_id: UUID) -> AuditTimelineEntry | None:
    from app.models.account_data import AccountAuditRow
    from app.models.entities import AuditRow

    is_synthetic = owner.kind == "DEMO"
    wf_row = db.get(WfAuditLogRow, event_id)
    if wf_row is not None and wf_row.owner_kind == owner.kind and wf_row.owner_id == owner.id:
        return _from_wf_row(wf_row, is_synthetic)
    if owner.kind == "DEMO":
        demo_row = db.get(AuditRow, event_id)
        if demo_row is not None and demo_row.session_id == owner.id:
            return _from_demo_audit_row(demo_row, True)
    elif owner.kind == "ACCOUNT":
        acct_row = db.get(AccountAuditRow, event_id)
        if acct_row is not None and acct_row.account_id == owner.id:
            return _from_account_audit_row(acct_row)
    return None


def log_wf_audit(
    db: Session,
    owner: Owner,
    event_type: str,
    category: str,
    *,
    actor_type: str = "SYSTEM",
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    summary: str | None = None,
    payload_sha256: str | None = None,
    payload_version: int = 1,
    metadata: dict | None = None,
    **kwargs,
) -> WfAuditLogRow:
    return record(
        db,
        owner,
        event_type=event_type,
        category="ACTIONS" if category == "ACTION" else category,
        title=summary or f"{event_type} {entity_type or ''}",
        summary=summary,
        actor_type="AI_PREPARED" if actor_type == "AGENT" else actor_type,
        action_id=entity_id if entity_type == "action" and isinstance(entity_id, UUID) else None,
        details=metadata,
    )
