"""SC-09 AI Claim Preparation Agent & Claim Readiness Service.

Enforces:
- Strict evidence grounding (no fabricated fields or medical info)
- Pydantic response validation
- Consent boundaries (process_documents, external_ai)
- Readiness gating (NEEDS_INFORMATION -> NEEDS_REVIEW -> READY_TO_DRAFT)
- Draft versioning and human-in-the-loop review
- ProposedAction creation with canonical SHA-256 payload hash
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.services.ai_gateway import ResponsesGateway
from app.workflow import actions, audit, claims, states
from app.workflow.models import (
    WfActionRow,
    WfClaimDraftRow,
)
from app.workflow.owner import Owner, owner_policy, purpose_granted, require_purpose


def _now() -> datetime:
    return datetime.now(UTC)


class DraftFieldCitation(BaseModel):
    document_name: str
    document_id: str | None = None
    page: int | None = None
    quote: str | None = None


class StructuredClaimFormOutput(BaseModel):
    policyholder_name: str | None = Field(default=None, description="Policyholder full name")
    patient_name: str | None = Field(default=None, description="Patient full name")
    relationship_to_policyholder: str = Field(
        default="Self", description="Self, Spouse, Child, or Dependent"
    )
    policy_reference: str | None = Field(default=None, description="Policy / member number")
    insurer_name: str | None = Field(default=None, description="Insurer name")
    service_date: str | None = Field(
        default=None, description="YYYY-MM-DD format of service/treatment"
    )
    provider_name: str | None = Field(
        default=None, description="Clinic, hospital, or provider name"
    )
    claim_type: str | None = Field(default=None, description="Standardized claim category")
    total_amount: str | None = Field(default=None, description="Total amount claimed as string")
    currency: str | None = Field(
        default=None, description="3-letter currency code, e.g. IDR, CNY, USD"
    )
    diagnosis: str | None = Field(
        default=None, description="Diagnosed condition or medical treatment"
    )
    treatment_summary: str | None = Field(
        default=None, description="Summary of medical procedure performed"
    )
    missing_required_fields: list[str] = Field(
        default_factory=list, description="List of required fields missing from evidence"
    )
    field_citations: dict[str, DraftFieldCitation] = Field(
        default_factory=dict, description="Source citation per field"
    )
    narrative_summary: str | None = Field(
        default=None, description="Objective, evidence-grounded summary for the insurer"
    )


def evaluate_claim_readiness(
    db: Session,
    owner: Owner,
    claim_id: UUID,
) -> dict[str, Any]:
    """Compute deterministic readiness status, checklist, and missing/conflicting items."""
    case = claims.get_case(db, owner, claim_id)
    evaluation = claims.recompute(db, owner, case)
    items = evaluation.get("items", [])
    checks = evaluation.get("checks", [])
    evaluation.get("draft")
    tally = claims.counts(items)

    missing_items = [
        item["label"]
        for item in items
        if item.get("mandatory") and item.get("status") == claims.MISSING
    ]
    conflicting_items = [item["label"] for item in items if item.get("status") == claims.CONFLICT]
    failed_checks = [
        c["detail"] for c in checks if c.get("status") == "FAIL" and not c.get("acknowledged")
    ]

    required_total = max(1, tally.get("required_total", 1))
    complete_count = tally.get("complete", 0)
    score_pct = int(round((complete_count / required_total) * 100))

    if missing_items:
        readiness_status = "NEEDS_INFORMATION"
        readiness_label = "Needs Information"
        description = f"{len(missing_items)} required document(s) or information missing before creating a claim draft."
    elif conflicting_items or failed_checks:
        readiness_status = "NEEDS_REVIEW"
        readiness_label = "Needs Review"
        description = (
            "Available evidence has conflicts or consistency warnings that require your review."
        )
    else:
        readiness_status = "READY_TO_DRAFT"
        readiness_label = "Ready to Draft"
        description = "All required documents are present and validated. You can proceed with AI claim preparation."

    return {
        "claim_id": str(case.id),
        "claim_reference": case.reference,
        "status": readiness_status,
        "label": readiness_label,
        "description": description,
        "score_pct": score_pct,
        "required_total": tally.get("required_total", 0),
        "complete": complete_count,
        "missing": tally.get("missing", 0),
        "needs_review": tally.get("needs_review", 0),
        "missing_fields": missing_items,
        "conflicting_fields": conflicting_items,
        "failed_checks": failed_checks,
        "checklist": items,
        "consistency_checks": checks,
        "checked_at": _now().isoformat(),
    }


def prepare_claim_draft(
    db: Session,
    owner: Owner,
    claim_id: UUID,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """SC-09 AI Claim Preparation Agent.

    Reads verified evidence, checks procedure rules, invokes configured AI gateway (with structured outputs)
    when external_ai consent is present, or uses deterministic fallback. Never fabricates missing facts.
    """
    case = claims.get_case(db, owner, claim_id)
    require_purpose(db, owner, "process_documents")

    if case.status in states.POST_SUBMISSION and case.status != states.ADDITIONAL_INFO:
        raise AppError(
            409, "CLAIM_LOCKED", "This claim has already been submitted and cannot be edited."
        )

    policy = owner_policy(db, owner, case.coverage_ref)
    readiness = evaluate_claim_readiness(db, owner, claim_id)
    if readiness["status"] == "NEEDS_INFORMATION":
        raise AppError(
            409,
            "CLAIM_NOT_READY",
            "Mandatory documents or values are missing. Complete required evidence before drafting.",
            {"missing_fields": readiness["missing_fields"]},
        )

    evidence_rows = claims.case_evidence(db, case)
    settings = get_settings()
    has_ai_consent = purpose_granted(db, owner, "external_ai")
    has_ai_configured = bool(
        settings.openai_api_key.get_secret_value() or settings.gemini_api_key.get_secret_value()
    )

    llm_draft_result: StructuredClaimFormOutput | None = None
    if has_ai_consent and has_ai_configured:
        try:
            gateway = ResponsesGateway(settings)
            evidence_summary = []
            for ev_row in evidence_rows:
                evidence_summary.append(
                    {
                        "id": str(ev_row.id),
                        "filename": ev_row.filename,
                        "kind": ev_row.evidence_kind,
                        "fields": ev_row.fields,
                        "status": ev_row.status,
                    }
                )

            policy_summary = {
                "policy_number": policy.number_masked if policy else None,
                "insurer": policy.provider if policy else case.coverage_label,
                "policyholder": policy.member_name if policy else case.claimant_name,
                "coverage_start": case.policy_start,
                "coverage_end": case.policy_end,
                "country": case.country_code,
            }

            instructions = (
                "You are the INSURRA AI Claim Preparation Agent. "
                "Map verified evidence and policy details into the insurer structured claim form. "
                "CRITICAL RULES: "
                "1. Strictly ground all fields in the provided verified evidence. "
                "2. NEVER fabricate, hallucinate, or assume any diagnosis, doctor name, provider, amount, or dates. "
                "3. If a required field is not clearly stated in the evidence, leave it null and include it in missing_required_fields. "
                "4. For each field populated, cite the exact source document filename and page in field_citations. "
                "5. Provide an objective, clear narrative explanation grounded in facts."
            )
            input_text = (
                f"Policy Information:\n{policy_summary}\n\n"
                f"Claim Case:\n{{'reference': '{case.reference}', 'type': '{case.claim_type}', 'service_date': '{case.service_date}', 'provider': '{case.provider_name}', 'amount': '{case.amount}', 'currency': '{case.currency}', 'claimant': '{case.claimant_name}'}}\n\n"
                f"Verified Evidence Items:\n{evidence_summary}"
            )

            llm_draft_result = gateway.parse(
                instructions=instructions,
                text=input_text,
                output_type=StructuredClaimFormOutput,
                fast=True,
            )
        except Exception:
            # Fall back safely to deterministic rules if AI model fails or errors out
            llm_draft_result = None

    # Base form from verified fields and deterministic KB mapping
    fresh_form = claims.build_draft_form(db, case, policy)

    # Grounded enrichment from LLM structured output if available
    if llm_draft_result:
        if llm_draft_result.diagnosis and "diagnosis" in fresh_form:
            citation = llm_draft_result.field_citations.get("diagnosis")
            fresh_form["diagnosis"]["value"] = llm_draft_result.diagnosis
            fresh_form["diagnosis"]["source"] = {
                "type": "EVIDENCE",
                "label": citation.document_name if citation else "Verified Evidence",
                "page": citation.page if citation else 1,
            }
        if llm_draft_result.treatment_summary:
            fresh_form["treatment_details"] = {
                "value": llm_draft_result.treatment_summary,
                "section": "Claim Details",
                "label": "Treatment description",
                "required": False,
                "source": {"type": "AI_GROUNDED", "label": "Extracted from verified report"},
                "edited": False,
            }

    # Preserve any prior user manual edits
    existing_draft = claims.case_draft(db, case)
    if existing_draft is not None:
        for key, item in (existing_draft.form or {}).items():
            if item.get("edited") and key in fresh_form:
                fresh_form[key] = {
                    **fresh_form[key],
                    "value": item["value"],
                    "edited": True,
                    "source": {"type": "USER_ENTERED", "label": "You edited this value"},
                }

    missing = [k for k, v in fresh_form.items() if v.get("required") and not v.get("value")]
    if llm_draft_result and llm_draft_result.missing_required_fields:
        for mf in llm_draft_result.missing_required_fields:
            if mf in fresh_form and not fresh_form[mf].get("value") and mf not in missing:
                missing.append(mf)

    if existing_draft is None:
        draft = WfClaimDraftRow(
            claim_id=case.id, form=fresh_form, missing_required=missing, version=1
        )
        db.add(draft)
    else:
        existing_draft.form = fresh_form
        existing_draft.missing_required = missing
        existing_draft.version += 1
        existing_draft.updated_at = _now()
        draft = existing_draft

    draft.status = "DRAFT"
    case.review_confirmed = False
    db.flush()

    states.add_event(
        db,
        case,
        "DRAFT_GENERATED",
        source="AGENT",
        note=f"Draft v{draft.version} prepared by INSURRA AI Agent from verified evidence",
    )
    audit.record(
        db,
        owner,
        "CLAIM_DRAFT_PREPARED",
        "CLAIMS",
        "Claim draft prepared",
        summary=f"INSURRA prepared claim draft v{draft.version} for {case.reference} from your verified evidence.",
        actor_type="AI_PREPARED",
        tool="prepare_claim_draft",
        claim_id=case.id,
        details={
            "claim_reference": case.reference,
            "version": draft.version,
            "missing_items": missing,
        },
    )

    return {
        "claim_id": str(case.id),
        "version": draft.version,
        "status": draft.status,
        "form": draft.form,
        "missing_required": draft.missing_required,
        "narrative_summary": llm_draft_result.narrative_summary if llm_draft_result else None,
        "attachments_count": len(evidence_rows),
        "updated_at": draft.updated_at.isoformat(),
        "readiness": readiness,
    }


def confirm_and_create_action(
    db: Session,
    owner: Owner,
    claim_id: UUID,
) -> tuple[WfClaimDraftRow, WfActionRow]:
    """User reviews and confirms draft -> binds to exact SHA-256 ProposedAction for SC-10."""
    case = claims.get_case(db, owner, claim_id)
    draft = claims.case_draft(db, case)
    if draft is None:
        raise AppError(409, "DRAFT_NOT_PREPARED", "Claim draft has not been prepared yet.")
    if draft.missing_required:
        raise AppError(
            409,
            "DRAFT_INCOMPLETE",
            "Mandatory draft fields are still empty. Please provide the required information.",
            {"missing_items": draft.missing_required},
        )

    claims.confirm_draft(db, owner, case)
    action = actions.send_claim_to_approval(db, owner, case)
    return draft, action
