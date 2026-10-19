"""Typed, owner-scoped, consent-checked agent tool registry (B1.13).

Every tool has an explicit `ToolPermissionClass`, Pydantic input/output models,
and `required_purposes`. Object identifiers in tool inputs are re-resolved through
owner-scoped queries (404 for foreign or missing rows). Tools of class
`CONSEQUENTIAL_EXTERNAL` are never exposed to the LLM and can only be invoked
through the explicit human-approved Action Review execution path.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.context import CoverageFact, UserContext, get_user_context
from app.core.config import get_settings
from app.core.errors import AppError
from app.models import AccountCoverageRow, AccountDocumentRow, InsuranceRecordRow
from app.schemas.common import Contract as StrictModel
from app.services.actor_scope import owner_for
from app.services.intervals import uncovered_interval
from app.services.kb_loader import CountryKBLoader
from app.services.safety_screen import (
    SafetyResult,
    get_verified_emergency_contacts,
    screen,
)
from app.workflow import actions, audit, claims, followup
from app.workflow.models import (
    WfActionRow,
    WfClaimCaseRow,
    WfClaimEvidenceRow,
    WfExecutionReceiptRow,
    WfReminderRow,
)
from app.workflow.owner import DEMO, Owner, owner_policies, purpose_granted


class ToolPermissionClass(StrEnum):
    READ_USER_CONTEXT = "READ_USER_CONTEXT"
    READ_PUBLIC_KNOWLEDGE = "READ_PUBLIC_KNOWLEDGE"
    DETERMINISTIC_COMPUTE = "DETERMINISTIC_COMPUTE"
    INTERNAL_STATE_UPDATE = "INTERNAL_STATE_UPDATE"
    DRAFT_PREPARATION = "DRAFT_PREPARATION"
    CONSEQUENTIAL_EXTERNAL = "CONSEQUENTIAL_EXTERNAL"
    SAFETY_ROUTING = "SAFETY_ROUTING"


LLM_EXPOSED_PERMISSION_CLASSES: frozenset[ToolPermissionClass] = frozenset(
    {
        ToolPermissionClass.READ_USER_CONTEXT,
        ToolPermissionClass.READ_PUBLIC_KNOWLEDGE,
        ToolPermissionClass.DETERMINISTIC_COMPUTE,
        ToolPermissionClass.DRAFT_PREPARATION,
    }
)


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    permission_class: ToolPermissionClass
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    required_purposes: tuple[str, ...]
    handler: Callable[[Session, Owner, Any], Any]


class EmptyToolInput(StrictModel):
    pass


class CoverageLookupInput(StrictModel):
    coverage_id: str | None = Field(default=None, max_length=80)


class CoverageListOutput(StrictModel):
    coverages: list[CoverageFact] = Field(default_factory=list)


class DocumentEvidenceInput(StrictModel):
    document_id: UUID


class DocumentEvidenceOutput(StrictModel):
    document_id: UUID
    filename: str
    status: str
    country_code: str | None = None


class ClaimLookupInput(StrictModel):
    claim_id: UUID


class ClaimStatusOutput(StrictModel):
    claim_id: UUID
    reference: str
    status: str
    evidence_count: int
    missing_items: list[str] = Field(default_factory=list)


class ActionLookupInput(StrictModel):
    action_id: UUID


class ExecutionReceiptOutput(StrictModel):
    action_id: UUID
    receipt_ref: str
    environment: str
    status: str
    summary: str


class CountryLookupInput(StrictModel):
    country_code: str = Field(min_length=2, max_length=2)


class CountryRulesOutput(StrictModel):
    country_code: str
    kb_version: str
    rule_ids: list[str] = Field(default_factory=list)
    emergency_contacts_count: int = 0


class ContinuityEvalInput(StrictModel):
    required_start: date | None = None
    required_end: date | None = None


class ContinuityEvalOutput(StrictModel):
    uncovered_days: int
    unverified_intervals: list[dict[str, str]] = Field(default_factory=list)
    status: str


class PrepareActionInput(StrictModel):
    action_type: str = Field(min_length=3, max_length=60)
    title: str = Field(min_length=3, max_length=200)
    purpose: str = Field(min_length=3, max_length=300)
    payload: dict[str, Any] = Field(default_factory=dict)
    claim_id: UUID | None = None


class PreparedActionOutput(StrictModel):
    action_id: UUID
    action_type: str
    status: str
    payload_sha256: str
    payload_version: int


class CancelReminderInput(StrictModel):
    reminder_id: UUID
    reason: str = Field(default="USER_REQUESTED", max_length=120)


class CancelReminderOutput(StrictModel):
    reminder_id: UUID
    status: str


class SafetyScreenInput(StrictModel):
    country_code: str = Field(min_length=2, max_length=2)
    text: str = Field(min_length=1, max_length=2000)


class ExecuteActionInput(StrictModel):
    action_id: UUID
    payload_sha256: str = Field(min_length=64, max_length=64)
    payload_version: int = Field(default=1, ge=1)
    idempotency_key: str = Field(min_length=8, max_length=120)


def _ensure_owned_coverage(db: Session, owner: Owner, coverage_id: str) -> None:
    policies = owner_policies(db, owner)
    if any(p.ref == str(coverage_id) for p in policies):
        return
    try:
        cov_uuid = UUID(str(coverage_id))
    except ValueError as exc:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Coverage record not found.") from exc
    if owner.kind == DEMO:
        rec = db.scalar(select(InsuranceRecordRow).where(InsuranceRecordRow.session_id == owner.id))
        if rec and any(str(p.get("id")) == str(cov_uuid) for p in rec.payload.get("policies", [])):
            return
    else:
        row = db.scalar(
            select(AccountCoverageRow).where(
                AccountCoverageRow.id == cov_uuid,
                AccountCoverageRow.account_id == owner.id,
            )
        )
        if row is not None:
            return
    raise AppError(404, "RESOURCE_NOT_FOUND", "Coverage record not found.")


def _ensure_owned_document(db: Session, owner: Owner, document_id: UUID) -> dict[str, Any]:
    if owner.kind == DEMO:
        rec = db.scalar(select(InsuranceRecordRow).where(InsuranceRecordRow.session_id == owner.id))
        if rec:
            for doc in rec.payload.get("documents", []):
                if str(doc.get("id")) == str(document_id):
                    return {
                        "id": document_id,
                        "filename": str(doc.get("filename", "demo-document")),
                        "status": str(doc.get("processing_status", "COMPLETED")),
                        "country_code": rec.payload.get("country_code"),
                    }
        raise AppError(404, "RESOURCE_NOT_FOUND", "Document not found.")
    row = db.scalar(
        select(AccountDocumentRow).where(
            AccountDocumentRow.id == document_id,
            AccountDocumentRow.account_id == owner.id,
        )
    )
    if row is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Document not found.")
    return {
        "id": row.id,
        "filename": row.filename,
        "status": row.status,
        "country_code": row.country_code,
    }


def _ensure_owned_claim(db: Session, owner: Owner, claim_id: UUID) -> WfClaimCaseRow:
    row = db.scalar(
        select(WfClaimCaseRow).where(
            WfClaimCaseRow.id == claim_id,
            WfClaimCaseRow.owner_kind == owner.kind,
            WfClaimCaseRow.owner_id == owner.id,
        )
    )
    if row is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Claim case not found.")
    return row


def _ensure_owned_action(db: Session, owner: Owner, action_id: UUID) -> WfActionRow:
    row = db.scalar(
        select(WfActionRow).where(
            WfActionRow.id == action_id,
            WfActionRow.owner_kind == owner.kind,
            WfActionRow.owner_id == owner.id,
        )
    )
    if row is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Action not found.")
    return row


def _ensure_owned_reminder(db: Session, owner: Owner, reminder_id: UUID) -> WfReminderRow:
    row = db.scalar(
        select(WfReminderRow).where(
            WfReminderRow.id == reminder_id,
            WfReminderRow.owner_kind == owner.kind,
            WfReminderRow.owner_id == owner.id,
        )
    )
    if row is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Reminder not found.")
    return row


def _handle_get_user_context(db: Session, owner: Owner, _inp: EmptyToolInput) -> UserContext:
    return get_user_context(db, owner)


def _handle_get_user_coverages(
    db: Session, owner: Owner, inp: CoverageLookupInput
) -> CoverageListOutput:
    ctx = get_user_context(db, owner)
    if inp.coverage_id is not None:
        _ensure_owned_coverage(db, owner, inp.coverage_id)
        return CoverageListOutput(
            coverages=[c for c in ctx.coverages if c.id == str(inp.coverage_id)]
        )
    return CoverageListOutput(coverages=ctx.coverages)


def _handle_get_policy_evidence(
    db: Session, owner: Owner, inp: DocumentEvidenceInput
) -> DocumentEvidenceOutput:
    doc = _ensure_owned_document(db, owner, inp.document_id)
    return DocumentEvidenceOutput(
        document_id=doc["id"],
        filename=doc["filename"],
        status=doc["status"],
        country_code=doc["country_code"],
    )


def _handle_get_claim_status(db: Session, owner: Owner, inp: ClaimLookupInput) -> ClaimStatusOutput:
    case = _ensure_owned_claim(db, owner, inp.claim_id)
    ev_rows = db.scalars(
        select(WfClaimEvidenceRow).where(WfClaimEvidenceRow.claim_id == case.id)
    ).all()
    readiness = claims.evaluate_readiness(db, case)
    missing = [
        item["kind"]
        for item in readiness.get("checklist", [])
        if item.get("mandatory") and not item.get("present")
    ]
    return ClaimStatusOutput(
        claim_id=case.id,
        reference=case.reference,
        status=case.status,
        evidence_count=len(ev_rows),
        missing_items=missing,
    )


def _handle_get_execution_receipt(
    db: Session, owner: Owner, inp: ActionLookupInput
) -> ExecutionReceiptOutput:
    act = _ensure_owned_action(db, owner, inp.action_id)
    rec = db.scalar(select(WfExecutionReceiptRow).where(WfExecutionReceiptRow.action_id == act.id))
    if rec is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Execution receipt not found.")
    return ExecutionReceiptOutput(
        action_id=act.id,
        receipt_ref=rec.receipt_ref,
        environment=rec.environment,
        status=rec.status,
        summary=rec.summary,
    )


def _handle_get_applicable_country_rules(
    _db: Session, _owner: Owner, inp: CountryLookupInput
) -> CountryRulesOutput:
    settings = get_settings()
    loader = CountryKBLoader(settings.kb_root, settings.active_kb_country_codes)
    country = loader.load(inp.country_code.upper())
    contacts_info = get_verified_emergency_contacts(inp.country_code.upper(), kb=loader)
    return CountryRulesOutput(
        country_code=country.manifest.country_code,
        kb_version=country.manifest.version,
        rule_ids=[r.rule_id for r in country.rules],
        emergency_contacts_count=len(contacts_info.get("contacts", [])),
    )


def _handle_evaluate_coverage_continuity(
    db: Session, owner: Owner, inp: ContinuityEvalInput
) -> ContinuityEvalOutput:
    ctx = get_user_context(db, owner)
    req_start = inp.required_start or (
        date.fromisoformat(ctx.study_start_date) if ctx.study_start_date else None
    )
    end_str = ctx.study_end_date or ctx.permit_end_date
    req_end = inp.required_end or (date.fromisoformat(end_str) if end_str else None)
    if req_start is None or req_end is None:
        return ContinuityEvalOutput(
            uncovered_days=0,
            unverified_intervals=[],
            status="NEEDS_VERIFICATION",
        )
    intervals: list[tuple[date, date]] = []
    for cov in ctx.coverages:
        if cov.start_date and cov.end_date:
            try:
                s = date.fromisoformat(cov.start_date)
                e = date.fromisoformat(cov.end_date)
                if s <= e:
                    intervals.append((s, e))
            except ValueError:
                continue
    days, gaps = uncovered_interval(req_start, req_end, intervals)
    return ContinuityEvalOutput(
        uncovered_days=days,
        unverified_intervals=[
            {"start_date": g.start_date.isoformat(), "end_date": g.end_date.isoformat()}
            for g in gaps
        ],
        status="NEEDS_VERIFICATION" if days > 0 or not intervals else "NO_ISSUE_DETECTED",
    )


def _handle_prepare_action(
    db: Session, owner: Owner, inp: PrepareActionInput
) -> PreparedActionOutput:
    claim_row = _ensure_owned_claim(db, owner, inp.claim_id) if inp.claim_id else None
    row = actions.prepare_action(
        db,
        owner,
        inp.action_type,
        title=inp.title,
        purpose=inp.purpose,
        payload=inp.payload,
        claim=claim_row,
    )
    return PreparedActionOutput(
        action_id=row.id,
        action_type=row.action_type,
        status=row.status,
        payload_sha256=row.payload_sha256,
        payload_version=row.payload_version,
    )


def _handle_cancel_coverage_reminder(
    db: Session, owner: Owner, inp: CancelReminderInput
) -> CancelReminderOutput:
    rem = _ensure_owned_reminder(db, owner, inp.reminder_id)
    if rem.policy_ref:
        followup.cancel_policy_reminders(db, owner, rem.policy_ref, inp.reason)
    else:
        rem.status = "CANCELLED"
    db.flush()
    return CancelReminderOutput(reminder_id=rem.id, status=rem.status)


def _handle_safety_screen(_db: Session, _owner: Owner, inp: SafetyScreenInput) -> SafetyResult:
    settings = get_settings()
    loader = CountryKBLoader(settings.kb_root, settings.active_kb_country_codes)
    return screen(inp.country_code.upper(), inp.text, kb=loader)


def _handle_execute_approved_sandbox_action(
    db: Session, owner: Owner, inp: ExecuteActionInput
) -> ExecutionReceiptOutput:
    act = _ensure_owned_action(db, owner, inp.action_id)
    result = actions.execute_action(
        db,
        owner,
        act.id,
        payload_sha256=inp.payload_sha256,
        payload_version=inp.payload_version,
        idempotency_key=inp.idempotency_key,
    )
    receipt = result["receipt"]
    return ExecutionReceiptOutput(
        action_id=act.id,
        receipt_ref=receipt["receipt_ref"],
        environment=receipt["environment"],
        status=receipt["status"],
        summary=receipt["summary"],
    )


TOOL_REGISTRY: dict[str, ToolSpec] = {
    "get_authorized_user_context": ToolSpec(
        name="get_authorized_user_context",
        description="Load the caller's owned context, situation, consents, and coverage summary.",
        permission_class=ToolPermissionClass.READ_USER_CONTEXT,
        input_model=EmptyToolInput,
        output_model=UserContext,
        required_purposes=(),
        handler=_handle_get_user_context,
    ),
    "get_user_coverages": ToolSpec(
        name="get_user_coverages",
        description="Read the caller's owned insurance coverages with provenance.",
        permission_class=ToolPermissionClass.READ_USER_CONTEXT,
        input_model=CoverageLookupInput,
        output_model=CoverageListOutput,
        required_purposes=("process_documents",),
        handler=_handle_get_user_coverages,
    ),
    "get_policy_evidence": ToolSpec(
        name="get_policy_evidence",
        description="Read metadata for an owned policy document.",
        permission_class=ToolPermissionClass.READ_USER_CONTEXT,
        input_model=DocumentEvidenceInput,
        output_model=DocumentEvidenceOutput,
        required_purposes=("process_documents",),
        handler=_handle_get_policy_evidence,
    ),
    "get_claim_status": ToolSpec(
        name="get_claim_status",
        description="Read status and missing evidence items for an owned claim case.",
        permission_class=ToolPermissionClass.READ_USER_CONTEXT,
        input_model=ClaimLookupInput,
        output_model=ClaimStatusOutput,
        required_purposes=("process_documents",),
        handler=_handle_get_claim_status,
    ),
    "get_execution_receipt": ToolSpec(
        name="get_execution_receipt",
        description="Read the execution receipt for an owned action.",
        permission_class=ToolPermissionClass.READ_USER_CONTEXT,
        input_model=ActionLookupInput,
        output_model=ExecutionReceiptOutput,
        required_purposes=("process_documents",),
        handler=_handle_get_execution_receipt,
    ),
    "get_applicable_country_rules": ToolSpec(
        name="get_applicable_country_rules",
        description="Read active versioned KB rules and verified emergency contacts for CN or ID.",
        permission_class=ToolPermissionClass.READ_PUBLIC_KNOWLEDGE,
        input_model=CountryLookupInput,
        output_model=CountryRulesOutput,
        required_purposes=(),
        handler=_handle_get_applicable_country_rules,
    ),
    "evaluate_coverage_continuity": ToolSpec(
        name="evaluate_coverage_continuity",
        description="Deterministically compute inclusive uncovered days across owned coverages.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=ContinuityEvalInput,
        output_model=ContinuityEvalOutput,
        required_purposes=("process_documents",),
        handler=_handle_evaluate_coverage_continuity,
    ),
    "prepare_action": ToolSpec(
        name="prepare_action",
        description="Prepare a reviewable draft action in AWAITING_APPROVAL state.",
        permission_class=ToolPermissionClass.DRAFT_PREPARATION,
        input_model=PrepareActionInput,
        output_model=PreparedActionOutput,
        required_purposes=("process_documents",),
        handler=_handle_prepare_action,
    ),
    "cancel_coverage_reminder": ToolSpec(
        name="cancel_coverage_reminder",
        description="Cancel a scheduled coverage reminder owned by the caller.",
        permission_class=ToolPermissionClass.INTERNAL_STATE_UPDATE,
        input_model=CancelReminderInput,
        output_model=CancelReminderOutput,
        required_purposes=(),
        handler=_handle_cancel_coverage_reminder,
    ),
    "safety_screen": ToolSpec(
        name="safety_screen",
        description="Run the deterministic multilingual safety screen against KB red flags.",
        permission_class=ToolPermissionClass.SAFETY_ROUTING,
        input_model=SafetyScreenInput,
        output_model=SafetyResult,
        required_purposes=(),
        handler=_handle_safety_screen,
    ),
    "execute_approved_sandbox_action": ToolSpec(
        name="execute_approved_sandbox_action",
        description="Execute a previously human-approved action bound to its exact SHA-256 hash.",
        permission_class=ToolPermissionClass.CONSEQUENTIAL_EXTERNAL,
        input_model=ExecuteActionInput,
        output_model=ExecutionReceiptOutput,
        required_purposes=("process_documents",),
        handler=_handle_execute_approved_sandbox_action,
    ),
}


def llm_visible_tools() -> list[ToolSpec]:
    """Return only tools safe to expose to the LLM planner.

    `CONSEQUENTIAL_EXTERNAL` tools are never exposed to the model.
    """
    return [
        spec
        for spec in TOOL_REGISTRY.values()
        if spec.permission_class in LLM_EXPOSED_PERMISSION_CLASSES
    ]


def invoke_tool(
    db: Session,
    actor_or_owner,
    tool_name: str,
    raw_input: dict[str, Any] | BaseModel | None = None,
    *,
    from_llm: bool = True,
) -> BaseModel:
    """Validate permissions, consents, and input schema, then invoke a registered tool."""
    spec = TOOL_REGISTRY.get(tool_name)
    if spec is None:
        raise AppError(404, "TOOL_NOT_FOUND", f"Unknown tool: {tool_name}")

    if from_llm and spec.permission_class == ToolPermissionClass.CONSEQUENTIAL_EXTERNAL:
        raise AppError(
            403,
            "CONSEQUENTIAL_TOOL_FORBIDDEN",
            "Consequential external tools cannot be invoked by the AI planner without human approval.",
        )

    owner = owner_for(actor_or_owner)
    missing_purposes = [p for p in spec.required_purposes if not purpose_granted(db, owner, p)]
    if missing_purposes:
        raise AppError(
            403,
            "CONSENT_REQUIRED",
            "Required data processing consent has not been granted.",
            {"required_purposes": missing_purposes},
        )

    if isinstance(raw_input, spec.input_model):
        validated_input = raw_input
    else:
        validated_input = spec.input_model.model_validate(raw_input or {})

    result = spec.handler(db, owner, validated_input)
    if not isinstance(result, spec.output_model):
        result = spec.output_model.model_validate(result)

    audit.agent_event(
        db,
        owner,
        f"tool.{spec.name}",
        "OK",
        detail={"status": spec.permission_class.value},
        event_type=f"tool.{spec.name}",
        entity_type="tool",
        entity_id=spec.name,
        status="DONE",
    )
    return result
