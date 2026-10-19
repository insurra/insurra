"""Owner-scoped claim, action, sandbox, reminder and audit tables.

Rows belong to exactly one actor: a demo session (owner_kind=DEMO) or an authenticated
account (owner_kind=ACCOUNT). Ownership is validated in the service layer for both kinds, so a
caller-supplied identifier is never trusted.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class WfClaimCaseRow(Base):
    __tablename__ = "wf_claim_cases"
    __table_args__ = (
        UniqueConstraint("owner_kind", "owner_id", "reference", name="uq_wf_claim_ref"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_kind: Mapped[str] = mapped_column(String(10), index=True)
    owner_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    reference: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200))
    claim_type: Mapped[str] = mapped_column(String(120))
    country_code: Mapped[str] = mapped_column(String(2))
    coverage_ref: Mapped[str | None] = mapped_column(String(64))
    coverage_label: Mapped[str | None] = mapped_column(String(200))
    insured_person: Mapped[str] = mapped_column(String(200), default="Self")
    claimant_name: Mapped[str | None] = mapped_column(String(200))
    product_id: Mapped[str | None] = mapped_column(String(100))
    procedure_id: Mapped[str | None] = mapped_column(String(100))
    service_date: Mapped[str | None] = mapped_column(String(10))
    provider_name: Mapped[str | None] = mapped_column(String(200))
    amount: Mapped[str | None] = mapped_column(String(30))
    currency: Mapped[str | None] = mapped_column(String(3))
    policy_start: Mapped[str | None] = mapped_column(String(10))
    policy_end: Mapped[str | None] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(40), default="DRAFT")
    origin: Mapped[str] = mapped_column(String(30), default="CLAIMS_CENTER")
    origin_ref: Mapped[str | None] = mapped_column(String(120))
    idempotency_key: Mapped[str | None] = mapped_column(String(120), index=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    review_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    conflict_notes: Mapped[dict] = mapped_column(JSON, default=dict)
    monitoring_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    monitoring_state: Mapped[str] = mapped_column(String(40), default="NOT_STARTED")
    notify_on_change: Mapped[bool] = mapped_column(Boolean, default=True)
    sandbox_ref: Mapped[str | None] = mapped_column(String(40))
    sandbox_status: Mapped[str | None] = mapped_column(String(40))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_poll_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    poll_attempts: Mapped[int] = mapped_column(Integer, default=0)
    poll_failures: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WfClaimItemRow(Base):
    __tablename__ = "wf_claim_items"
    __table_args__ = (UniqueConstraint("claim_id", "code", name="uq_wf_item_code"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    claim_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("wf_claim_cases.id"), index=True)
    code: Mapped[str] = mapped_column(String(80))
    label: Mapped[str] = mapped_column(String(300))
    label_original: Mapped[str | None] = mapped_column(String(300))
    reason: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(String(500))
    kb_ref: Mapped[str | None] = mapped_column(String(100))
    accepted_formats: Mapped[list] = mapped_column(JSON, default=list)
    mandatory: Mapped[bool] = mapped_column(Boolean, default=True)
    kind: Mapped[str] = mapped_column(String(40), default="DOCUMENT")
    evidence_kind: Mapped[str | None] = mapped_column(String(40))
    user_added: Mapped[bool] = mapped_column(Boolean, default=False)
    not_applicable: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)


class WfClaimEvidenceRow(Base):
    __tablename__ = "wf_claim_evidence"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    claim_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("wf_claim_cases.id"), index=True)
    evidence_kind: Mapped[str] = mapped_column(String(40))
    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str | None] = mapped_column(String(100))
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    sha256: Mapped[str | None] = mapped_column(String(64))
    content: Mapped[bytes | None] = mapped_column(LargeBinary)
    source_type: Mapped[str] = mapped_column(String(30))
    source_document_id: Mapped[str | None] = mapped_column(String(64))
    # {field_key: {"value": ..., "source_page": int|None, "confirmed": bool, "origin": str}}
    fields: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="NEEDS_REVIEW")
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WfClaimDraftRow(Base):
    __tablename__ = "wf_claim_drafts"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    claim_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("wf_claim_cases.id"), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    # {field_key: {"value", "source", "source_ref", "edited"}}
    form: Mapped[dict] = mapped_column(JSON, default=dict)
    missing_required: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WfClaimStatusEventRow(Base):
    __tablename__ = "wf_claim_status_events"
    __table_args__ = (UniqueConstraint("claim_id", "dedupe_key", name="uq_wf_status_dedupe"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    claim_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("wf_claim_cases.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(60))
    from_status: Mapped[str | None] = mapped_column(String(40))
    to_status: Mapped[str | None] = mapped_column(String(40))
    source: Mapped[str] = mapped_column(String(20), default="SYSTEM")
    note: Mapped[str | None] = mapped_column(String(300))
    dedupe_key: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WfActionRow(Base):
    __tablename__ = "wf_actions"
    __table_args__ = (
        UniqueConstraint("owner_kind", "owner_id", "dedupe_key", name="uq_wf_action"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_kind: Mapped[str] = mapped_column(String(10), index=True)
    owner_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    reference: Mapped[str] = mapped_column(String(30))
    claim_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("wf_claim_cases.id"), index=True)
    action_type: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(200))
    purpose: Mapped[str] = mapped_column(String(500))
    destination: Mapped[str] = mapped_column(String(60))
    environment: Mapped[str] = mapped_column(String(20))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    payload_sha256: Mapped[str] = mapped_column(String(64))
    payload_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(30), default="AWAITING_APPROVAL")
    required_permissions: Mapped[list] = mapped_column(JSON, default=list)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dedupe_key: Mapped[str | None] = mapped_column(String(120))
    ai_prepared: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WfActionApprovalRow(Base):
    __tablename__ = "wf_action_approvals"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    action_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("wf_actions.id"), index=True)
    owner_kind: Mapped[str] = mapped_column(String(10))
    owner_id: Mapped[UUID] = mapped_column(Uuid)
    decision: Mapped[str] = mapped_column(String(12))
    action_type: Mapped[str] = mapped_column(String(50))
    payload_sha256: Mapped[str] = mapped_column(String(64))
    payload_version: Mapped[int] = mapped_column(Integer)
    destination: Mapped[str] = mapped_column(String(60))
    permissions: Mapped[list] = mapped_column(JSON, default=list)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invalidation_reason: Mapped[str | None] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WfActionExecutionRow(Base):
    __tablename__ = "wf_action_executions"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    action_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("wf_actions.id"), index=True)
    approval_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("wf_action_approvals.id"))
    idempotency_key: Mapped[str] = mapped_column(String(120), unique=True)
    environment: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20))
    error_code: Mapped[str | None] = mapped_column(String(60))
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WfExecutionReceiptRow(Base):
    __tablename__ = "wf_execution_receipts"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    receipt_ref: Mapped[str] = mapped_column(String(40), unique=True)
    action_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("wf_actions.id"), index=True)
    execution_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("wf_action_executions.id"))
    owner_kind: Mapped[str] = mapped_column(String(10))
    owner_id: Mapped[UUID] = mapped_column(Uuid)
    environment: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20))
    claim_ref: Mapped[str | None] = mapped_column(String(40))
    payload_digest: Mapped[str] = mapped_column(String(64))
    audit_event_id: Mapped[UUID | None] = mapped_column(Uuid)
    next_action: Mapped[str | None] = mapped_column(String(200))
    signature: Mapped[str] = mapped_column(String(64))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WfSandboxClaimRow(Base):
    __tablename__ = "wf_sandbox_claims"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    claim_ref: Mapped[str] = mapped_column(String(40), unique=True)
    idempotency_key: Mapped[str] = mapped_column(String(120), unique=True)
    owner_kind: Mapped[str] = mapped_column(String(10), index=True)
    owner_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    payload_digest: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(40))
    decision_reason: Mapped[str | None] = mapped_column(String(300))
    missing_items: Mapped[list] = mapped_column(JSON, default=list)
    history: Mapped[list] = mapped_column(JSON, default=list)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    advance_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WfReminderRow(Base):
    __tablename__ = "wf_reminders"
    __table_args__ = (
        UniqueConstraint("owner_kind", "owner_id", "dedupe_key", name="uq_wf_reminder"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_kind: Mapped[str] = mapped_column(String(10), index=True)
    owner_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    kind: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str | None] = mapped_column(String(500))
    policy_ref: Mapped[str | None] = mapped_column(String(64))
    claim_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("wf_claim_cases.id"))
    offset_days: Mapped[int | None] = mapped_column(Integer)
    due_date: Mapped[str] = mapped_column(String(10))
    fire_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str | None] = mapped_column(String(64))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="SCHEDULED")
    dedupe_key: Mapped[str] = mapped_column(String(160))
    evidence_status: Mapped[str] = mapped_column(String(30), default="UNVERIFIED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WfAgentEventRow(Base):
    __tablename__ = "wf_agent_events"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_kind: Mapped[str] = mapped_column(String(10), index=True)
    owner_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    tool: Mapped[str] = mapped_column(String(60))
    outcome: Mapped[str] = mapped_column(String(20))
    claim_id: Mapped[UUID | None] = mapped_column(Uuid)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    event_type: Mapped[str | None] = mapped_column(String(60), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    dedupe_key: Mapped[str | None] = mapped_column(String(200), index=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(60))
    schema_version: Mapped[str] = mapped_column(String(10), default="1.5")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WfAuditLogRow(Base):
    __tablename__ = "wf_audit_logs"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_kind: Mapped[str] = mapped_column(String(10), index=True)
    owner_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    event_type: Mapped[str] = mapped_column(String(60), index=True)
    category: Mapped[str] = mapped_column(String(20), index=True)
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str | None] = mapped_column(String(500))
    actor_type: Mapped[str] = mapped_column(String(30))
    tool: Mapped[str | None] = mapped_column(String(60))
    result_status: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str | None] = mapped_column(String(300))
    claim_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    action_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    receipt_ref: Mapped[str | None] = mapped_column(String(40))
    evidence_refs: Mapped[list] = mapped_column(JSON, default=list)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )
