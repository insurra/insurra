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
from decimal import Decimal
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.context import CoverageFact, UserContext, get_user_context
from app.core.config import get_settings
from app.core.errors import AppError
from app.models import (
    AccountCoverageRow,
    AccountDocumentRow,
    AccountFieldRow,
    AccountProfileRow,
    InsuranceRecordRow,
    ProfileRow,
)
from app.schemas.common import Contract as StrictModel
from app.services.actor_scope import owner_for
from app.services.intervals import uncovered_interval
from app.services.kb_loader import CountryKBLoader
from app.services.safety_screen import (
    SafetyResult,
    get_verified_emergency_contacts,
    screen,
)
from app.workflow import actions, audit, claims, followup, kbdata
from app.workflow import evidence as ev
from app.workflow.models import (
    WfActionRow,
    WfClaimCaseRow,
    WfClaimEvidenceRow,
    WfExecutionReceiptRow,
    WfReminderRow,
)
from app.workflow.owner import DEMO, Owner, owner_policies, owner_policy, purpose_granted


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


# --- Specialized Protection Review Agent Models (PR-01 to PR-14) ---


class AnalyzeNeedsInput(StrictModel):
    country_code: str = Field(default="ID", max_length=2)
    situation: str | None = None
    occupation: str | None = None
    has_dependents: bool = False
    has_exposures: bool = False
    health_sharing_preference: str | None = None


class AnalyzedNeedItem(StrictModel):
    code: str
    title: str
    category: str
    requirement_level: str
    reason: str
    evidence_basis: list[str] = Field(default_factory=list)
    applicable_rules: list[str] = Field(default_factory=list)


class AnalyzeNeedsOutput(StrictModel):
    country_code: str
    needs: list[AnalyzedNeedItem] = Field(default_factory=list)


class CheckCompletenessInput(StrictModel):
    country_code: str = Field(default="ID", max_length=2)


class CheckCompletenessOutput(StrictModel):
    onboarding_complete: bool
    missing_essential_fields: list[str] = Field(default_factory=list)
    missing_document_types: list[str] = Field(default_factory=list)
    verified_policies_count: int = 0
    unverified_policies_count: int = 0
    completeness_status: str


class MatchCoverageInput(StrictModel):
    need_codes: list[str] = Field(default_factory=list)


class MatchedCoverageItem(StrictModel):
    coverage_id: str | None = None
    provider: str
    plan_name: str
    policy_type: str | None = None
    benefit_name: str
    benefit_limit: str | None = None
    verification_status: str
    source_origin: str


class NeedCoverageMatch(StrictModel):
    need_code: str
    matched_coverages: list[MatchedCoverageItem] = Field(default_factory=list)
    is_verified: bool
    status: str


class MatchCoverageOutput(StrictModel):
    matches: list[NeedCoverageMatch] = Field(default_factory=list)


class CalculateGapsInput(StrictModel):
    matches: list[NeedCoverageMatch] = Field(default_factory=list)
    residence_context: str | None = None
    visa_end_date: str | None = None
    study_end_date: str | None = None


class GapFindingItem(StrictModel):
    need_code: str
    title: str
    category: str
    status: str
    reason: str
    uncovered_days: int | None = None
    interval_start: str | None = None
    interval_end: str | None = None
    priority: str
    suggested_action: str
    risks: list[str] = Field(default_factory=list)


class CalculateGapsOutput(StrictModel):
    findings: list[GapFindingItem] = Field(default_factory=list)


class CheckExclusionsInput(StrictModel):
    coverage_ids: list[str] = Field(default_factory=list)


class ExclusionFinding(StrictModel):
    coverage_id: str
    provider: str
    exclusion_text: str
    category: str
    affects_needs: list[str] = Field(default_factory=list)
    uncertainty_note: str


class WaitingPeriodFinding(StrictModel):
    coverage_id: str
    provider: str
    period_text: str
    waiting_days: int | None = None
    warning: str


class CheckExclusionsOutput(StrictModel):
    exclusions: list[ExclusionFinding] = Field(default_factory=list)
    waiting_periods: list[WaitingPeriodFinding] = Field(default_factory=list)


class EvaluateOverlapInput(StrictModel):
    coverage_ids: list[str] = Field(default_factory=list)


class OverlapItem(StrictModel):
    benefit_name: str
    policies_involved: list[str] = Field(default_factory=list)
    coordination_guidance: str


class EvaluateOverlapOutput(StrictModel):
    overlaps: list[OverlapItem] = Field(default_factory=list)
    total_overlapping_policies: int = 0


class ClaimCaseToolInput(StrictModel):
    claim_id: UUID


class ClaimCaseToolOutput(StrictModel):
    claim_id: UUID
    reference: str
    status: str
    claim_type: str
    country_code: str
    service_date: str | None = None
    provider_name: str | None = None
    amount: str | None = None
    currency: str | None = None
    policy_start: str | None = None
    policy_end: str | None = None
    coverage_ref: str | None = None


class PolicyLookupInput(StrictModel):
    coverage_ref: str | None = None


class PolicyLookupOutput(StrictModel):
    policy_number: str | None = None
    insurer: str | None = None
    holder: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    country: str | None = None


class VerifiedEvidenceOutput(StrictModel):
    claim_id: UUID
    evidence_items: list[dict[str, Any]] = Field(default_factory=list)


class ClaimRequirementsOutput(StrictModel):
    claim_id: UUID
    requirements: list[dict[str, Any]] = Field(default_factory=list)


class ClaimReadinessReportOutput(StrictModel):
    claim_id: UUID
    status: str
    score_pct: int
    required_total: int
    complete: int
    missing: int
    needs_review: int
    missing_fields: list[str] = Field(default_factory=list)
    conflicting_fields: list[str] = Field(default_factory=list)


class ClaimProcedureInput(StrictModel):
    country_code: str = Field(min_length=2, max_length=2)
    product_id: str | None = None


class ClaimProcedureOutput(StrictModel):
    procedure_id: str | None = None
    name: str | None = None
    filing_deadlines: dict[str, Any] | None = None
    instructions: list[str] = Field(default_factory=list)


class ValidateClaimFieldsInput(StrictModel):
    service_date: str | None = None
    amount: str | None = None
    currency: str | None = None


class ValidateClaimFieldsOutput(StrictModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)


class CalculateClaimAmountInput(StrictModel):
    amounts: list[str] = Field(default_factory=list)
    currency: str = "IDR"


class CalculateClaimAmountOutput(StrictModel):
    total: str
    currency: str
    item_count: int


class CheckRequiredFieldsInput(StrictModel):
    fields: dict[str, Any] = Field(default_factory=dict)
    required_keys: list[str] = Field(default_factory=list)


class CheckRequiredFieldsOutput(StrictModel):
    is_complete: bool
    missing_keys: list[str] = Field(default_factory=list)


class DocumentConsistencyOutput(StrictModel):
    claim_id: UUID
    has_conflicts: bool
    checks: list[dict[str, Any]] = Field(default_factory=list)


class ClaimDraftToolOutput(StrictModel):
    claim_id: UUID
    version: int
    status: str
    form: dict[str, Any] = Field(default_factory=dict)
    missing_required: list[str] = Field(default_factory=list)


class CreateActionToolOutput(StrictModel):
    action_id: UUID
    reference: str
    action_type: str
    payload_sha256: str
    status: str


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
    eval_res = claims.recompute(db, owner, case)
    missing = [
        item["code"]
        for item in eval_res.get("items", [])
        if item.get("mandatory") and item.get("status") == "MISSING"
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
    view = actions.receipt_view(db, rec)
    return ExecutionReceiptOutput(
        action_id=act.id,
        receipt_ref=rec.receipt_ref,
        environment=rec.environment,
        status=rec.status,
        summary=str(view.get("notice") or rec.next_action or ""),
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
    if act.payload_sha256 != inp.payload_sha256 or act.payload_version != inp.payload_version:
        raise AppError(
            403,
            "APPROVAL_HASH_MISMATCH",
            "The payload differs from what was approved.",
        )
    receipt, _ = actions.execute(db, owner, act)
    return ExecutionReceiptOutput(
        action_id=act.id,
        receipt_ref=str(receipt["receipt_reference"]),
        environment=str(receipt["environment"]),
        status=str(receipt["status"]),
        summary=str(receipt.get("notice") or receipt.get("next_action") or ""),
    )


def _handle_analyze_needs(
    _db: Session, _owner: Owner, inp: AnalyzeNeedsInput
) -> AnalyzeNeedsOutput:
    country = (inp.country_code or "ID").upper()
    needs: list[AnalyzedNeedItem] = []

    # 1. Core medical protection
    needs.append(
        AnalyzedNeedItem(
            code="core_medical",
            title="Core Medical Protection",
            category="private_medical",
            requirement_level="REQUIRED_VERIFIED",
            reason="Protection against primary inpatient hospitalization and outpatient care costs.",
            evidence_basis=["PROFILE", "OFFICIAL_RULE"],
            applicable_rules=["NATIONAL_HEALTHCARE_STANDARD"],
        )
    )

    # 2. Student requirement (PR-05)
    sit = (inp.situation or inp.occupation or "").upper()
    if "STUDENT" in sit:
        needs.append(
            AnalyzedNeedItem(
                code="student_requirement",
                title="Student & Study Protection",
                category="international_student",
                requirement_level="REQUIRED_VERIFIED",
                reason="Mandatory compliance with educational institution and student visa requirements.",
                evidence_basis=["PROFILE", "OFFICIAL_RULE"],
                applicable_rules=["STUDENT_VISA_HEALTH_REQUIREMENT"],
            )
        )

    # 3. Dependent protection
    if inp.has_dependents:
        needs.append(
            AnalyzedNeedItem(
                code="dependent_protection",
                title="Family & Dependent Protection",
                category="life",
                requirement_level="RECOMMENDED",
                reason="Living cost continuity and income replacement security for dependents.",
                evidence_basis=["PROFILE"],
                applicable_rules=["DEPENDENT_LIVING_SAFEGUARD"],
            )
        )

    # 4. Activity and accident exposure
    if inp.has_exposures:
        needs.append(
            AnalyzedNeedItem(
                code="activity_exposure",
                title="Accident & Activity Safeguard",
                category="personal_accident",
                requirement_level="RECOMMENDED",
                reason="Protection against occupational hazards and sports or lifestyle activity risks.",
                evidence_basis=["PROFILE"],
                applicable_rules=["ACCIDENTAL_INJURY_PROTECTION"],
            )
        )

    # 5. Sensitive health access preferences (PR-03)
    if inp.health_sharing_preference == "SHARE_RELEVANT":
        needs.append(
            AnalyzedNeedItem(
                code="health_preferences",
                title="Healthcare Access & Specialized Needs",
                category="private_medical",
                requirement_level="OPTIONAL",
                reason="Voluntary preferences for ongoing medication or specific specialist care access.",
                evidence_basis=["PROFILE"],
                applicable_rules=["VOLUNTARY_CARE_ACCESS"],
            )
        )

    # 6. Emergency assistance
    needs.append(
        AnalyzedNeedItem(
            code="emergency_assistance",
            title="Emergency Medical Assistance",
            category="emergency_assistance",
            requirement_level="RECOMMENDED",
            reason="Emergency medical evacuation, rescue coordination, and repatriation assistance.",
            evidence_basis=["PROFILE", "OFFICIAL_RULE"],
            applicable_rules=["EMERGENCY_EVACUATION_STANDARD"],
        )
    )

    return AnalyzeNeedsOutput(country_code=country, needs=needs)


def _handle_check_completeness(
    db: Session, owner: Owner, inp: CheckCompletenessInput
) -> CheckCompletenessOutput:
    missing_essential: list[str] = []
    missing_docs: list[str] = []

    # PR-01 / PR-02: Check essential profile fields
    occ = owner.occupation
    if not occ:
        if owner.is_demo:
            prof = db.scalar(select(ProfileRow).where(ProfileRow.session_id == owner.id))
            occ = prof.payload.get("occupation") if prof else None
        else:
            acc_prof = db.scalar(
                select(AccountProfileRow).where(AccountProfileRow.account_id == owner.id)
            )
            occ = acc_prof.payload.get("occupation") if acc_prof else None

    if not occ:
        missing_essential.append("occupation")

    policies = owner_policies(db, owner)
    verified_count = sum(1 for p in policies if p.verification in ("VERIFIED", "USER_CONFIRMED"))
    unverified_count = sum(
        1 for p in policies if p.verification not in ("VERIFIED", "USER_CONFIRMED")
    )

    if verified_count == 0:
        missing_docs.append("policy_document")

    status = (
        "COMPLETE"
        if not missing_essential and verified_count > 0
        else ("PARTIAL" if not missing_essential else "INCOMPLETE")
    )

    return CheckCompletenessOutput(
        onboarding_complete=not missing_essential,
        missing_essential_fields=missing_essential,
        missing_document_types=missing_docs,
        verified_policies_count=verified_count,
        unverified_policies_count=unverified_count,
        completeness_status=status,
    )


def _handle_match_coverage(
    db: Session, owner: Owner, inp: MatchCoverageInput
) -> MatchCoverageOutput:
    policies = owner_policies(db, owner)
    matches: list[NeedCoverageMatch] = []

    for code in inp.need_codes:
        matched_items: list[MatchedCoverageItem] = []
        is_verified = False

        for pol in policies:
            prov = pol.provider or "Provider"
            name = pol.name or pol.kind
            norm_name = f"{prov} {name} {pol.kind}".casefold()

            # NEGATIVE CASE GUARD:
            # MSIG commercial liability must never be considered personal health coverage!
            is_comm_liability = (
                "commercial liability" in norm_name
                or "general liability" in norm_name
                or "tanggung gugat" in norm_name
                or ("msig" in norm_name and "liability" in norm_name)
            )

            if code == "core_medical":
                if is_comm_liability:
                    continue  # Strictly skip commercial liability from personal medical!
                if any(
                    k in norm_name
                    for k in (
                        "health",
                        "medical",
                        "bpjs",
                        "student",
                        "rawat inap",
                        "hospital",
                        "prusehat",
                        "preferred medical",
                        "miultimate",
                    )
                ):
                    ver = pol.verification
                    matched_items.append(
                        MatchedCoverageItem(
                            coverage_id=pol.ref,
                            provider=prov,
                            plan_name=name,
                            policy_type=pol.kind,
                            benefit_name="Inpatient and Outpatient Medical Expenses",
                            benefit_limit=(
                                "Covered per policy schedule"
                                if ver == "VERIFIED"
                                else "Limit unverified"
                            ),
                            verification_status=ver,
                            source_origin="DOCUMENT_EXTRACTED"
                            if ver == "VERIFIED"
                            else "USER_DECLARED",
                        )
                    )
                    if ver in ("VERIFIED", "USER_CONFIRMED"):
                        is_verified = True

            elif code.casefold() in ("dental", "dental_care"):
                if any(k in norm_name for k in ("dental", "gigi")):
                    ver = pol.verification
                    matched_items.append(
                        MatchedCoverageItem(
                            coverage_id=pol.ref,
                            provider=prov,
                            plan_name=name,
                            policy_type=pol.kind,
                            benefit_name="Dental Care",
                            benefit_limit=(
                                "Covered per policy schedule"
                                if ver == "VERIFIED"
                                else "Dental benefit terms are not verified"
                            ),
                            verification_status=ver,
                            source_origin="DOCUMENT_EXTRACTED"
                            if ver == "VERIFIED"
                            else "USER_DECLARED",
                        )
                    )
                    if ver in ("VERIFIED", "USER_CONFIRMED"):
                        is_verified = True

            elif code == "student_requirement":
                if any(k in norm_name for k in ("student", "mahasiswa", "aia-stu", "campus")):
                    ver = pol.verification
                    matched_items.append(
                        MatchedCoverageItem(
                            coverage_id=pol.ref,
                            provider=prov,
                            plan_name=name,
                            policy_type=pol.kind,
                            benefit_name="Student Medical & Evacuation",
                            benefit_limit="Full coverage per student schedule",
                            verification_status=ver,
                            source_origin="DOCUMENT_EXTRACTED"
                            if ver == "VERIFIED"
                            else "USER_DECLARED",
                        )
                    )
                    if ver in ("VERIFIED", "USER_CONFIRMED"):
                        is_verified = True

            elif code.casefold() in ("dental", "dental_care"):
                if any(k in norm_name for k in ("dental", "gigi")):
                    ver = pol.verification
                    matched_items.append(
                        MatchedCoverageItem(
                            coverage_id=pol.ref,
                            provider=prov,
                            plan_name=name,
                            policy_type=pol.kind,
                            benefit_name="Dental Care",
                            benefit_limit=(
                                "Covered per policy schedule"
                                if ver == "VERIFIED"
                                else "Dental benefit terms are not verified"
                            ),
                            verification_status=ver,
                            source_origin="DOCUMENT_EXTRACTED"
                            if ver == "VERIFIED"
                            else "USER_DECLARED",
                        )
                    )
                    if ver in ("VERIFIED", "USER_CONFIRMED"):
                        is_verified = True

            elif code == "dependent_protection":
                if any(k in norm_name for k in ("life", "family", "jiwa", "term life", "keluarga")):
                    ver = pol.verification
                    matched_items.append(
                        MatchedCoverageItem(
                            coverage_id=pol.ref,
                            provider=prov,
                            plan_name=name,
                            policy_type=pol.kind,
                            benefit_name="Term Life & Family Benefit",
                            benefit_limit="Death and disability benefit",
                            verification_status=ver,
                            source_origin="DOCUMENT_EXTRACTED"
                            if ver == "VERIFIED"
                            else "USER_DECLARED",
                        )
                    )
                    if ver in ("VERIFIED", "USER_CONFIRMED"):
                        is_verified = True

            elif code.casefold() in ("dental", "dental_care"):
                if any(k in norm_name for k in ("dental", "gigi")):
                    ver = pol.verification
                    matched_items.append(
                        MatchedCoverageItem(
                            coverage_id=pol.ref,
                            provider=prov,
                            plan_name=name,
                            policy_type=pol.kind,
                            benefit_name="Dental Care",
                            benefit_limit=(
                                "Covered per policy schedule"
                                if ver == "VERIFIED"
                                else "Dental benefit terms are not verified"
                            ),
                            verification_status=ver,
                            source_origin="DOCUMENT_EXTRACTED"
                            if ver == "VERIFIED"
                            else "USER_DECLARED",
                        )
                    )
                    if ver in ("VERIFIED", "USER_CONFIRMED"):
                        is_verified = True

            elif code == "activity_exposure":
                if any(k in norm_name for k in ("accident", "kecelakaan", "personal accident")):
                    ver = pol.verification
                    matched_items.append(
                        MatchedCoverageItem(
                            coverage_id=pol.ref,
                            provider=prov,
                            plan_name=name,
                            policy_type=pol.kind,
                            benefit_name="Accidental Medical & Disability",
                            benefit_limit="Lump sum accidental indemnity",
                            verification_status=ver,
                            source_origin="DOCUMENT_EXTRACTED"
                            if ver == "VERIFIED"
                            else "USER_DECLARED",
                        )
                    )
                    if ver in ("VERIFIED", "USER_CONFIRMED"):
                        is_verified = True

            elif code.casefold() in ("dental", "dental_care"):
                if any(k in norm_name for k in ("dental", "gigi")):
                    ver = pol.verification
                    matched_items.append(
                        MatchedCoverageItem(
                            coverage_id=pol.ref,
                            provider=prov,
                            plan_name=name,
                            policy_type=pol.kind,
                            benefit_name="Dental Care",
                            benefit_limit=(
                                "Covered per policy schedule"
                                if ver == "VERIFIED"
                                else "Dental benefit terms are not verified"
                            ),
                            verification_status=ver,
                            source_origin="DOCUMENT_EXTRACTED"
                            if ver == "VERIFIED"
                            else "USER_DECLARED",
                        )
                    )
                    if ver in ("VERIFIED", "USER_CONFIRMED"):
                        is_verified = True

            elif code == "emergency_assistance":
                if any(
                    k in norm_name
                    for k in ("student", "travel", "evacuation", "repatriation", "rescue")
                ):
                    ver = pol.verification
                    matched_items.append(
                        MatchedCoverageItem(
                            coverage_id=pol.ref,
                            provider=prov,
                            plan_name=name,
                            policy_type=pol.kind,
                            benefit_name="Emergency Evacuation & Repatriation",
                            benefit_limit="Up to RMB 500,000 / standard limit",
                            verification_status=ver,
                            source_origin="DOCUMENT_EXTRACTED"
                            if ver == "VERIFIED"
                            else "USER_DECLARED",
                        )
                    )
                    if ver in ("VERIFIED", "USER_CONFIRMED"):
                        is_verified = True

            elif code.casefold() in ("dental", "dental_care"):
                if any(k in norm_name for k in ("dental", "gigi")):
                    ver = pol.verification
                    matched_items.append(
                        MatchedCoverageItem(
                            coverage_id=pol.ref,
                            provider=prov,
                            plan_name=name,
                            policy_type=pol.kind,
                            benefit_name="Dental Care",
                            benefit_limit=(
                                "Covered per policy schedule"
                                if ver == "VERIFIED"
                                else "Dental benefit terms are not verified"
                            ),
                            verification_status=ver,
                            source_origin="DOCUMENT_EXTRACTED"
                            if ver == "VERIFIED"
                            else "USER_DECLARED",
                        )
                    )
                    if ver in ("VERIFIED", "USER_CONFIRMED"):
                        is_verified = True

        # CRITICAL REQUIREMENT:
        # If benefit is unverified, status is UNKNOWN or NEEDS_VERIFICATION, NEVER NOT_COVERED!
        if matched_items:
            status = "COVERED" if is_verified else "NEEDS_VERIFICATION"
        else:
            status = "POTENTIAL_GAP"

        matches.append(
            NeedCoverageMatch(
                need_code=code,
                matched_coverages=matched_items,
                is_verified=is_verified,
                status=status,
            )
        )

    return MatchCoverageOutput(matches=matches)


def _handle_calculate_gaps(
    db: Session, owner: Owner, inp: CalculateGapsInput
) -> CalculateGapsOutput:
    findings: list[GapFindingItem] = []
    policies = owner_policies(db, owner)

    for match in inp.matches:
        code = match.need_code
        status = match.status
        uncovered_days: int | None = None
        int_start: str | None = None
        int_end: str | None = None

        if code == "core_medical":
            title = "Core Medical Protection"
            cat = "private_medical"
            if status == "COVERED":
                reason = (
                    "Verified policy evidence confirms active medical and hospitalization benefits."
                )
                action = "Maintain active coverage and review hospital network before admission."
                prio = "LOW"
                risks = []
            elif status == "NEEDS_VERIFICATION":
                reason = "Health protection is reported or evidenced, but benefit schedule or active dates remain unverified."
                action = (
                    "Upload policy schedule or certificate to verify benefits and active dates."
                )
                prio = "NORMAL"
                risks = ["Out of pocket payment risk if benefit scope or limits are restricted."]
            elif status == "UNKNOWN":
                reason = "Medical protection terms cannot be confirmed from existing evidence."
                action = "Request policy confirmation from provider to clarify terms."
                prio = "NORMAL"
                risks = ["Unknown deductible or copay obligations."]
            else:
                reason = "No active health insurance recorded to cover major medical and hospital expenses."
                action = "Review officially sourced health insurance options or enroll in national scheme."
                prio = "HIGH"
                risks = [
                    "Severe financial exposure from inpatient hospital stays and surgical bills."
                ]

        elif code == "student_requirement":
            title = "Student & Study Protection"
            cat = "international_student"
            # Check date continuity if study_end_date or visa_end_date is provided (PR-08)
            target_end = inp.study_end_date or inp.visa_end_date
            if target_end and match.is_verified:
                active_ends = [p.end for p in policies if p.end]
                if active_ends:
                    latest_end = max(active_ends)
                    if latest_end < target_end:
                        status = "POTENTIAL_GAP"
                        try:
                            d_cov = date.fromisoformat(latest_end)
                            d_target = date.fromisoformat(target_end)
                            uncovered_days = max(0, (d_target - d_cov).days)
                            int_start = latest_end
                            int_end = target_end
                        except ValueError:
                            pass

            if status == "COVERED":
                reason = "Verified student policy meets campus requirements."
                action = "Keep enrollment and student policy certificate on file."
                prio = "LOW"
                risks = []
            elif status == "POTENTIAL_GAP" and uncovered_days and uncovered_days > 0:
                reason = (
                    f"Coverage expires {uncovered_days} days before your study or visa period ends."
                )
                action = "Arrange renewal or an extension policy before current coverage lapses."
                prio = "HIGH"
                risks = ["Potential breach of visa conditions or campus enrollment freeze."]
            elif status == "NEEDS_VERIFICATION":
                reason = "Student policy reported, but campus compliance and active period remain unverified."
                action = "Verify university insurance endorsement with student affairs office."
                prio = "NORMAL"
                risks = ["Risk of hold on course registration if policy is not endorsed."]
            else:
                reason = "No student policy recorded for mandatory campus and visa compliance."
                action = "Check university endorsed insurance requirements or purchase recognized student cover."
                prio = "HIGH"
                risks = ["Visa condition breach and denial of student services."]

        elif code == "dependent_protection":
            title = "Family & Dependent Protection"
            cat = "life"
            if status == "COVERED":
                reason = "Verified life or family protection is in place."
                action = "Review beneficiary designation and adequacy of coverage limit annually."
                prio = "LOW"
                risks = []
            elif status == "NEEDS_VERIFICATION":
                reason = "Family protection reported, but sum assured and term details need verification."
                action = "Check policy document to confirm beneficiary and sum assured."
                prio = "NORMAL"
                risks = ["Inadequate income replacement for dependents if sum assured is low."]
            else:
                reason = "Financial dependents identified without active life or family income protection."
                action = "Consider basic term life coverage to secure dependent living expenses."
                prio = "HIGH"
                risks = [
                    "Financial vulnerability for dependents in event of disability or loss of provider."
                ]

        elif code == "activity_exposure":
            title = "Accident & Activity Safeguard"
            cat = "personal_accident"
            if status == "COVERED":
                reason = "Personal accident coverage is active."
                action = "Check hazardous activity exclusions before undertaking high-risk sports."
                prio = "LOW"
                risks = []
            elif status == "NEEDS_VERIFICATION":
                reason = "Accident protection reported, but exclusion clauses and limits need confirmation."
                action = "Review policy exclusions for specific activity and travel hazards."
                prio = "NORMAL"
                risks = ["Unexpected claim rejection for excluded hobbies or occupational tasks."]
            else:
                reason = "Reported activity exposures are not protected against accidental injury."
                action = (
                    "Consider personal accident cover for medical reimbursement and disability."
                )
                prio = "NORMAL"
                risks = [
                    "Out of pocket rehabilitation and treatment costs from accidental injuries."
                ]

        elif code == "emergency_assistance":
            title = "Emergency Medical Assistance"
            cat = "emergency_assistance"
            if status == "COVERED":
                reason = "Emergency medical evacuation and repatriation are confirmed."
                action = "Save 24/7 assistance hotline number in your phone contacts."
                prio = "LOW"
                risks = []
            elif status == "NEEDS_VERIFICATION":
                reason = "Assistance benefits reported, but emergency provider contacts need verification."
                action = "Confirm emergency hotline and pre-authorization procedures."
                prio = "NORMAL"
                risks = ["Delays in arranging air evacuation in urgent medical situations."]
            else:
                reason = "No emergency medical evacuation assistance recorded."
                action = (
                    "Ensure travel or international medical policy includes emergency evacuation."
                )
                prio = "HIGH"
                risks = ["Catastrophic evacuation expenses if medical repatriation is needed."]

        else:
            title = code.replace("_", " ").title()
            cat = "general"
            reason = "Assessment completed."
            action = "Review coverage details."
            prio = "NORMAL"
            risks = []

        findings.append(
            GapFindingItem(
                need_code=code,
                title=title,
                category=cat,
                status=status,
                reason=reason,
                uncovered_days=uncovered_days,
                interval_start=int_start,
                interval_end=int_end,
                priority=prio,
                suggested_action=action,
                risks=risks,
            )
        )

    return CalculateGapsOutput(findings=findings)


def _handle_check_exclusions(
    db: Session, owner: Owner, inp: CheckExclusionsInput
) -> CheckExclusionsOutput:
    exclusions: list[ExclusionFinding] = []
    waiting_periods: list[WaitingPeriodFinding] = []

    if not owner.is_demo and purpose_granted(db, owner, "process_documents"):
        rows = db.scalars(
            select(AccountFieldRow).where(
                AccountFieldRow.account_id == owner.id,
                AccountFieldRow.field_key.in_(("exclusions", "waiting_periods", "provider")),
            )
        ).all()
        by_doc: dict[str, dict[str, Any]] = {}
        for r in rows:
            k = str(r.document_id)
            if k not in by_doc:
                by_doc[k] = {}
            by_doc[k][r.field_key] = r.value

        for doc_id, fields in by_doc.items():
            prov = str(fields.get("provider", "Provider"))
            raw_ex = fields.get("exclusions")
            if isinstance(raw_ex, list):
                for ex in raw_ex:
                    ex_str = str(ex)
                    exclusions.append(
                        ExclusionFinding(
                            coverage_id=doc_id,
                            provider=prov,
                            exclusion_text=ex_str,
                            category="general_exclusion",
                            affects_needs=["core_medical"],
                            uncertainty_note="Pre-existing medical conditions not disclosed are subject to review.",
                        )
                    )
            raw_wp = fields.get("waiting_periods")
            if isinstance(raw_wp, list):
                for wp in raw_wp:
                    wp_str = str(wp)
                    waiting_periods.append(
                        WaitingPeriodFinding(
                            coverage_id=doc_id,
                            provider=prov,
                            period_text=wp_str,
                            waiting_days=30 if "30" in wp_str else None,
                            warning="Treatments during the initial waiting period are not reimbursable.",
                        )
                    )

    return CheckExclusionsOutput(exclusions=exclusions, waiting_periods=waiting_periods)


def _handle_evaluate_overlap(
    db: Session, owner: Owner, inp: EvaluateOverlapInput
) -> EvaluateOverlapOutput:
    policies = owner_policies(db, owner)
    overlaps: list[OverlapItem] = []

    med_policies = [
        p
        for p in policies
        if any(
            k in f"{p.provider} {p.name or ''} {p.kind}".casefold()
            for k in ("health", "medical", "bpjs", "student")
        )
    ]
    if len(med_policies) >= 2:
        overlaps.append(
            OverlapItem(
                benefit_name="Inpatient Hospitalization & Treatment",
                policies_involved=[f"{p.provider} ({p.name or p.kind})" for p in med_policies],
                coordination_guidance="Use primary insurer (e.g. national BPJS) first; submit remaining excess or upgrade charges to private insurer.",
            )
        )

    return EvaluateOverlapOutput(
        overlaps=overlaps,
        total_overlapping_policies=len(med_policies) if len(med_policies) >= 2 else 0,
    )


def _handle_get_claim_case(
    db: Session, owner: Owner, inp: ClaimCaseToolInput
) -> ClaimCaseToolOutput:
    case = claims.get_case(db, owner, inp.claim_id)
    return ClaimCaseToolOutput(
        claim_id=case.id,
        reference=case.reference,
        status=case.status,
        claim_type=case.claim_type,
        country_code=case.country_code,
        service_date=case.service_date,
        provider_name=case.provider_name,
        amount=case.amount,
        currency=case.currency,
        policy_start=case.policy_start,
        policy_end=case.policy_end,
        coverage_ref=case.coverage_ref,
    )


def _handle_get_authorized_policy(
    db: Session, owner: Owner, inp: PolicyLookupInput
) -> PolicyLookupOutput:
    policy = owner_policy(db, owner, inp.coverage_ref)
    if policy is None:
        return PolicyLookupOutput()
    return PolicyLookupOutput(
        policy_number=policy.number_masked,
        insurer=policy.provider,
        holder=policy.member_name,
        start_date=policy.start_date,
        end_date=policy.end_date,
        country=policy.country_code,
    )


def _handle_get_verified_claim_evidence(
    db: Session, owner: Owner, inp: ClaimCaseToolInput
) -> VerifiedEvidenceOutput:
    case = claims.get_case(db, owner, inp.claim_id)
    rows = claims.case_evidence(db, case)
    items = []
    for r in rows:
        items.append(
            {
                "id": str(r.id),
                "filename": r.filename,
                "evidence_kind": r.evidence_kind,
                "status": r.status,
                "fields": r.fields,
            }
        )
    return VerifiedEvidenceOutput(claim_id=case.id, evidence_items=items)


def _handle_get_claim_requirements(
    db: Session, owner: Owner, inp: ClaimCaseToolInput
) -> ClaimRequirementsOutput:
    case = claims.get_case(db, owner, inp.claim_id)
    evaluation = claims.recompute(db, owner, case)
    return ClaimRequirementsOutput(claim_id=case.id, requirements=evaluation.get("items", []))


def _handle_get_claim_readiness_report(
    db: Session, owner: Owner, inp: ClaimCaseToolInput
) -> ClaimReadinessReportOutput:
    from app.services import claim_preparation_agent

    res = claim_preparation_agent.evaluate_claim_readiness(db, owner, inp.claim_id)
    return ClaimReadinessReportOutput(
        claim_id=inp.claim_id,
        status=res["status"],
        score_pct=res["score_pct"],
        required_total=res["required_total"],
        complete=res["complete"],
        missing=res["missing"],
        needs_review=res["needs_review"],
        missing_fields=res["missing_fields"],
        conflicting_fields=res["conflicting_fields"],
    )


def _handle_retrieve_claim_procedure(
    db: Session, owner: Owner, inp: ClaimProcedureInput
) -> ClaimProcedureOutput:
    procedure = kbdata.procedure_for_product(inp.country_code, inp.product_id)
    if not procedure:
        return ClaimProcedureOutput()
    return ClaimProcedureOutput(
        procedure_id=procedure.get("procedure_id"),
        name=procedure.get("name"),
        filing_deadlines=procedure.get("filing_deadlines"),
        instructions=procedure.get("instructions") or [],
    )


def _handle_validate_claim_fields(
    db: Session, owner: Owner, inp: ValidateClaimFieldsInput
) -> ValidateClaimFieldsOutput:
    errors: list[str] = []
    if inp.service_date:
        d = ev.parse_date(inp.service_date)
        if d is None:
            errors.append("Invalid service date format. Expected YYYY-MM-DD.")
        elif d > date.today():
            errors.append("Service date cannot be in the future.")
    if inp.amount:
        m = ev.parse_money(inp.amount, inp.currency)
        if m is None or m <= Decimal("0"):
            errors.append("Amount must be a positive valid number.")
    if inp.currency and len(inp.currency) != 3:
        errors.append("Currency must be a 3-letter ISO code.")
    return ValidateClaimFieldsOutput(valid=len(errors) == 0, errors=errors)


def _handle_calculate_claim_amount(
    db: Session, owner: Owner, inp: CalculateClaimAmountInput
) -> CalculateClaimAmountOutput:
    total = Decimal("0")
    for amt_str in inp.amounts:
        parsed = ev.parse_money(amt_str, inp.currency)
        if parsed:
            total += parsed
    return CalculateClaimAmountOutput(
        total=ev.money_str(total) or "0",
        currency=inp.currency,
        item_count=len(inp.amounts),
    )


def _handle_check_required_fields(
    db: Session, owner: Owner, inp: CheckRequiredFieldsInput
) -> CheckRequiredFieldsOutput:
    missing = [k for k in inp.required_keys if not inp.fields.get(k)]
    return CheckRequiredFieldsOutput(is_complete=len(missing) == 0, missing_keys=missing)


def _handle_verify_document_consistency(
    db: Session, owner: Owner, inp: ClaimCaseToolInput
) -> DocumentConsistencyOutput:
    case = claims.get_case(db, owner, inp.claim_id)
    rows = claims.case_evidence(db, case)
    checks = claims.evaluate_checks(db, case, rows)
    has_conflicts = any(c.get("status") == "FAIL" and not c.get("acknowledged") for c in checks)
    return DocumentConsistencyOutput(claim_id=case.id, has_conflicts=has_conflicts, checks=checks)


def _handle_generate_claim_form(
    db: Session, owner: Owner, inp: ClaimCaseToolInput
) -> ClaimDraftToolOutput:
    case = claims.get_case(db, owner, inp.claim_id)
    policy = owner_policy(db, owner, case.coverage_ref)
    form = claims.build_draft_form(db, case, policy)
    missing = [k for k, v in form.items() if v.get("required") and not v.get("value")]
    return ClaimDraftToolOutput(
        claim_id=case.id,
        version=1,
        status="DRAFT",
        form=form,
        missing_required=missing,
    )


def _handle_create_claim_draft(
    db: Session, owner: Owner, inp: ClaimCaseToolInput
) -> ClaimDraftToolOutput:
    from app.services import claim_preparation_agent

    res = claim_preparation_agent.prepare_claim_draft(db, owner, inp.claim_id)
    return ClaimDraftToolOutput(
        claim_id=inp.claim_id,
        version=res["version"],
        status=res["status"],
        form=res["form"],
        missing_required=res["missing_required"],
    )


def _handle_create_proposed_action(
    db: Session, owner: Owner, inp: ClaimCaseToolInput
) -> CreateActionToolOutput:
    from app.services import claim_preparation_agent

    _draft, action = claim_preparation_agent.confirm_and_create_action(db, owner, inp.claim_id)
    return CreateActionToolOutput(
        action_id=action.id,
        reference=action.reference,
        action_type=action.action_type,
        payload_sha256=action.payload_sha256,
        status=action.status,
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
    "analyze_needs": ToolSpec(
        name="analyze_needs",
        description="Determine applicable protection needs based on country rules and user situation.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=AnalyzeNeedsInput,
        output_model=AnalyzeNeedsOutput,
        required_purposes=(),
        handler=_handle_analyze_needs,
    ),
    "check_completeness": ToolSpec(
        name="check_completeness",
        description="Verify profile completeness and evidence sufficiency.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=CheckCompletenessInput,
        output_model=CheckCompletenessOutput,
        required_purposes=(),
        handler=_handle_check_completeness,
    ),
    "match_coverage": ToolSpec(
        name="match_coverage",
        description="Match owned policies to protection needs using canonical taxonomy.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=MatchCoverageInput,
        output_model=MatchCoverageOutput,
        required_purposes=(),
        handler=_handle_match_coverage,
    ),
    "calculate_gaps": ToolSpec(
        name="calculate_gaps",
        description="Evaluate gaps, continuity intervals, and uncertainty for protection needs.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=CalculateGapsInput,
        output_model=CalculateGapsOutput,
        required_purposes=(),
        handler=_handle_calculate_gaps,
    ),
    "check_exclusions": ToolSpec(
        name="check_exclusions",
        description="Identify active exclusions, waiting periods, and uncertainty in owned policies.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=CheckExclusionsInput,
        output_model=CheckExclusionsOutput,
        required_purposes=(),
        handler=_handle_check_exclusions,
    ),
    "evaluate_overlap": ToolSpec(
        name="evaluate_overlap",
        description="Evaluate dual-coverage coordination between primary and secondary policies.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=EvaluateOverlapInput,
        output_model=EvaluateOverlapOutput,
        required_purposes=(),
        handler=_handle_evaluate_overlap,
    ),
    "get_claim_case": ToolSpec(
        name="get_claim_case",
        description="Load details of an authorized claim case.",
        permission_class=ToolPermissionClass.READ_USER_CONTEXT,
        input_model=ClaimCaseToolInput,
        output_model=ClaimCaseToolOutput,
        required_purposes=(),
        handler=_handle_get_claim_case,
    ),
    "get_authorized_policy": ToolSpec(
        name="get_authorized_policy",
        description="Read policy information authorized for the current caller.",
        permission_class=ToolPermissionClass.READ_USER_CONTEXT,
        input_model=PolicyLookupInput,
        output_model=PolicyLookupOutput,
        required_purposes=(),
        handler=_handle_get_authorized_policy,
    ),
    "get_verified_claim_evidence": ToolSpec(
        name="get_verified_claim_evidence",
        description="Retrieve verified and user-confirmed evidence attached to a claim.",
        permission_class=ToolPermissionClass.READ_USER_CONTEXT,
        input_model=ClaimCaseToolInput,
        output_model=VerifiedEvidenceOutput,
        required_purposes=("process_documents",),
        handler=_handle_get_verified_claim_evidence,
    ),
    "get_claim_requirements": ToolSpec(
        name="get_claim_requirements",
        description="Retrieve mandatory, conditional, and optional evidence requirements for a claim.",
        permission_class=ToolPermissionClass.READ_PUBLIC_KNOWLEDGE,
        input_model=ClaimCaseToolInput,
        output_model=ClaimRequirementsOutput,
        required_purposes=(),
        handler=_handle_get_claim_requirements,
    ),
    "get_claim_readiness_report": ToolSpec(
        name="get_claim_readiness_report",
        description="Get structured readiness report with missing and conflicting items.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=ClaimCaseToolInput,
        output_model=ClaimReadinessReportOutput,
        required_purposes=(),
        handler=_handle_get_claim_readiness_report,
    ),
    "retrieve_claim_procedure": ToolSpec(
        name="retrieve_claim_procedure",
        description="Load official claim submission guidelines and filing deadlines from KB.",
        permission_class=ToolPermissionClass.READ_PUBLIC_KNOWLEDGE,
        input_model=ClaimProcedureInput,
        output_model=ClaimProcedureOutput,
        required_purposes=(),
        handler=_handle_retrieve_claim_procedure,
    ),
    "validate_claim_fields": ToolSpec(
        name="validate_claim_fields",
        description="Validate service date, amount, and currency deterministically.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=ValidateClaimFieldsInput,
        output_model=ValidateClaimFieldsOutput,
        required_purposes=(),
        handler=_handle_validate_claim_fields,
    ),
    "calculate_claim_amount": ToolSpec(
        name="calculate_claim_amount",
        description="Calculate total claimed amount with currency-safe arithmetic.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=CalculateClaimAmountInput,
        output_model=CalculateClaimAmountOutput,
        required_purposes=(),
        handler=_handle_calculate_claim_amount,
    ),
    "check_required_fields": ToolSpec(
        name="check_required_fields",
        description="Check if required fields are satisfied in draft payload.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=CheckRequiredFieldsInput,
        output_model=CheckRequiredFieldsOutput,
        required_purposes=(),
        handler=_handle_check_required_fields,
    ),
    "verify_document_consistency": ToolSpec(
        name="verify_document_consistency",
        description="Cross-check documents against policy period, deadlines, and identity.",
        permission_class=ToolPermissionClass.DETERMINISTIC_COMPUTE,
        input_model=ClaimCaseToolInput,
        output_model=DocumentConsistencyOutput,
        required_purposes=(),
        handler=_handle_verify_document_consistency,
    ),
    "generate_claim_form": ToolSpec(
        name="generate_claim_form",
        description="Map evidence facts to insurer claim form schema.",
        permission_class=ToolPermissionClass.DRAFT_PREPARATION,
        input_model=ClaimCaseToolInput,
        output_model=ClaimDraftToolOutput,
        required_purposes=("process_documents",),
        handler=_handle_generate_claim_form,
    ),
    "create_claim_draft": ToolSpec(
        name="create_claim_draft",
        description="Run AI Claim Preparation Agent to prepare a verified claim draft.",
        permission_class=ToolPermissionClass.DRAFT_PREPARATION,
        input_model=ClaimCaseToolInput,
        output_model=ClaimDraftToolOutput,
        required_purposes=("process_documents",),
        handler=_handle_create_claim_draft,
    ),
    "create_proposed_action": ToolSpec(
        name="create_proposed_action",
        description="Convert a confirmed draft into a ProposedAction for human approval in Action Queue.",
        permission_class=ToolPermissionClass.DRAFT_PREPARATION,
        input_model=ClaimCaseToolInput,
        output_model=CreateActionToolOutput,
        required_purposes=("process_documents",),
        handler=_handle_create_proposed_action,
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
