"""Workflow router for Joshua (SC-08, SC-09, SC-10, SC-11, SC-15, SC-17, SC-19).

Serves both demo sessions and authenticated account sessions with strict ownership isolation.
"""

from uuid import UUID

from fastapi import APIRouter, File, Query, UploadFile
from pydantic import BaseModel, Field

from app.core.errors import AppError
from app.workflow import (
    actions,
    audit,
    catalog_views,
    claims,
    emergency,
    followup,
    kbdata,
    proof,
    servicing,
    states,
)
from app.workflow import (
    evidence as ev,
)
from app.workflow.models import WfActionRow, WfClaimCaseRow, WfClaimEvidenceRow
from app.workflow.owner import DB, CurrentOwner, OptionalOwner, owner_policies

router = APIRouter(prefix="/workflow", tags=["Joshua Workflow"])


# =============================================================================
# SC-09: CLAIMS WORKSPACE
# =============================================================================


class CreateClaimRequest(BaseModel):
    coverage_ref: str
    claim_type: str
    title: str | None = None
    insured_person: str = "Self"
    claimant_name: str | None = None


class EditClaimRequest(BaseModel):
    title: str | None = None
    claim_type: str | None = None
    service_date: str | None = None
    provider_name: str | None = None
    amount: str | None = None
    currency: str | None = None
    claimant_name: str | None = None
    insured_person: str | None = None


class ConfirmFieldsRequest(BaseModel):
    values: dict[str, str]


class EditDraftRequest(BaseModel):
    values: dict[str, str]


class AcknowledgeCheckRequest(BaseModel):
    check_code: str
    note: str = Field(min_length=3, max_length=300)


@router.get("/claims/overview")
def claims_overview(db: DB, owner: CurrentOwner):
    """Provides high-level stats, banner, and recent activity matching screenshot 1."""
    # Ensure policy reminders are up to date
    followup.sync_policy_reminders(db, owner)

    all_cases = (
        db.query(WfClaimCaseRow)
        .filter_by(owner_kind=owner.kind, owner_id=owner.id)
        .order_by(WfClaimCaseRow.updated_at.desc())
        .all()
    )
    open_cases = [
        c
        for c in all_cases
        if c.status not in (states.APPROVED_SANDBOX, states.REJECTED_SANDBOX, states.CANCELLED)
    ]
    ready_cases = [c for c in all_cases if c.status == states.READY_FOR_APPROVAL]
    awaiting_cases = [c for c in all_cases if c.status == states.AWAITING_APPROVAL]

    # Find pending action for banner
    pending_action = (
        db.query(WfActionRow)
        .filter_by(
            owner_kind=owner.kind,
            owner_id=owner.id,
            status="AWAITING_APPROVAL",
        )
        .order_by(WfActionRow.created_at.desc())
        .first()
    )

    # Recent activity
    audit_events, _ = audit.query_events(db, owner, limit=5)

    return {
        "stats": {
            "total_cases": len(all_cases),
            "open_cases": len(open_cases),
            "ready_to_submit": len(ready_cases),
            "awaiting_approval": len(awaiting_cases),
        },
        "awaiting_approval_banner": None
        if not pending_action
        else {
            "action_id": pending_action.id,
            "action_reference": pending_action.reference,
            "title": pending_action.title,
            "purpose": pending_action.purpose,
            "claim_id": pending_action.claim_id,
        },
        "recent_activity": [
            {
                "id": a.id,
                "event_type": a.event_type,
                "category": a.category,
                "title": a.title,
                "summary": a.summary,
                "actor_type": a.actor_type,
                "created_at": a.created_at,
            }
            for a in audit_events
        ],
        "available_policies": [
            {
                "ref": p.ref,
                "name": p.name or p.provider or p.kind,
                "provider": p.provider,
                "kind": p.kind,
                "number_masked": p.number_masked,
                "start": p.start,
                "end": p.end,
            }
            for p in owner_policies(db, owner)
        ],
    }


@router.get("/claims/cases")
def list_claim_cases(
    db: DB,
    owner: CurrentOwner,
    status_filter: str | None = None,
    q: str | None = None,
):
    query = db.query(WfClaimCaseRow).filter_by(owner_kind=owner.kind, owner_id=owner.id)
    all_rows = query.order_by(WfClaimCaseRow.updated_at.desc()).all()

    # Categorize counts for tab badges
    counts = {
        "all": len(all_rows),
        "draft": sum(1 for c in all_rows if c.status == states.DRAFT),
        "ready": sum(1 for c in all_rows if c.status == states.READY_FOR_APPROVAL),
        "submitted": sum(
            1
            for c in all_rows
            if c.status
            in (
                states.SUBMITTED,
                states.PROCESSING,
                states.APPROVED_SANDBOX,
                states.REJECTED_SANDBOX,
            )
        ),
        "needs_action": sum(
            1
            for c in all_rows
            if c.status
            in (
                states.MISSING_EVIDENCE,
                states.NEEDS_REVIEW,
                states.AWAITING_APPROVAL,
                states.ADDITIONAL_INFO,
            )
        ),
    }

    filtered = all_rows
    if status_filter:
        flt = status_filter.upper()
        if flt == "DRAFT":
            filtered = [c for c in filtered if c.status == states.DRAFT]
        elif flt == "READY":
            filtered = [c for c in filtered if c.status == states.READY_FOR_APPROVAL]
        elif flt == "SUBMITTED":
            filtered = [
                c
                for c in filtered
                if c.status
                in (
                    states.SUBMITTED,
                    states.PROCESSING,
                    states.APPROVED_SANDBOX,
                    states.REJECTED_SANDBOX,
                )
            ]
        elif flt in ("NEEDS_ACTION", "NEEDS_DOCUMENTS", "ACTION"):
            filtered = [
                c
                for c in filtered
                if c.status
                in (
                    states.MISSING_EVIDENCE,
                    states.NEEDS_REVIEW,
                    states.AWAITING_APPROVAL,
                    states.ADDITIONAL_INFO,
                )
            ]

    if q:
        term = q.casefold()
        filtered = [
            c
            for c in filtered
            if term in c.reference.casefold()
            or term in c.title.casefold()
            or term in c.claim_type.casefold()
            or term in (c.coverage_label or "").casefold()
        ]

    return {
        "counts": counts,
        "cases": [claims.case_summary(c) for c in filtered],
    }


@router.post("/claims/cases", status_code=201)
def create_claim_case(body: CreateClaimRequest, db: DB, owner: CurrentOwner):
    case = claims.create_case(
        db,
        owner,
        policy_ref=body.coverage_ref,
        claim_type=body.claim_type,
        title=body.title,
        insured_person=body.insured_person,
        claimant_name=body.claimant_name,
    )
    db.commit()
    return claims.case_detail(db, owner, case)


@router.get("/claims/cases/{claim_id}")
def get_claim_case_detail(claim_id: UUID, db: DB, owner: CurrentOwner):
    case = claims.get_case(db, owner, claim_id)
    return claims.case_detail(db, owner, case)


@router.patch("/claims/cases/{claim_id}")
def edit_claim_case(claim_id: UUID, body: EditClaimRequest, db: DB, owner: CurrentOwner):
    case = claims.get_case(db, owner, claim_id)
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    claims.update_case_fields(db, owner, case, changes)
    db.commit()
    return claims.case_detail(db, owner, case)


@router.post("/claims/cases/{claim_id}/evidence")
async def upload_claim_evidence(
    claim_id: UUID,
    db: DB,
    owner: CurrentOwner,
    file: UploadFile = File(...),
    evidence_kind: str = Query("FAPIAO"),
):
    case = claims.get_case(db, owner, claim_id)
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise AppError(422, "FILE_TOO_LARGE", "File size exceeds 10 MB limit.")

    from app.services.account_documents import (
        extract_text_or_ocr,
        remove_injection_lines,
        sniff_mime,
    )

    mime = sniff_mime(content)

    # Text extraction and injection defense
    pages = extract_text_or_ocr(content, mime, case.country_code)
    patterns = kbdata.injection_patterns()
    clean_pages, injection_flag = remove_injection_lines(pages, patterns)

    # Parse fields conservatively
    parsed_fields = ev.parse_invoice_text([(p.page_no, p.text) for p in clean_pages])
    fields_to_store = ev.fields_for_kind(evidence_kind, parsed_fields)

    claims.add_evidence(
        db,
        owner,
        case,
        kind=evidence_kind,
        filename=file.filename or "uploaded_document",
        source_type="DOCUMENT_UPLOAD",
        fields=fields_to_store,
        mime_type=mime,
        content=content,
        injection_flag=injection_flag,
    )
    claims.sync_case_from_evidence(db, owner, case)
    db.commit()
    return claims.case_detail(db, owner, case)


@router.patch("/claims/cases/{claim_id}/evidence/{evidence_id}/confirm")
def confirm_evidence_fields(
    claim_id: UUID,
    evidence_id: UUID,
    body: ConfirmFieldsRequest,
    db: DB,
    owner: CurrentOwner,
):
    case = claims.get_case(db, owner, claim_id)
    ev_row = db.get(WfClaimEvidenceRow, evidence_id)
    if ev_row is None or ev_row.claim_id != case.id:
        raise AppError(404, "NOT_FOUND", "Evidence file not found on this claim.")
    claims.confirm_fields(db, owner, case, ev_row, body.values)
    db.commit()
    return claims.case_detail(db, owner, case)


@router.post("/claims/cases/{claim_id}/draft")
def generate_claim_draft(claim_id: UUID, db: DB, owner: CurrentOwner):
    case = claims.get_case(db, owner, claim_id)
    claims.generate_draft(db, owner, case)
    db.commit()
    return claims.case_detail(db, owner, case)


@router.patch("/claims/cases/{claim_id}/draft")
def edit_claim_draft(claim_id: UUID, body: EditDraftRequest, db: DB, owner: CurrentOwner):
    case = claims.get_case(db, owner, claim_id)
    claims.edit_draft(db, owner, case, body.values)
    db.commit()
    return claims.case_detail(db, owner, case)


@router.post("/claims/cases/{claim_id}/draft/confirm")
def confirm_claim_draft(claim_id: UUID, db: DB, owner: CurrentOwner):
    case = claims.get_case(db, owner, claim_id)
    claims.confirm_draft(db, owner, case)
    db.commit()
    return claims.case_detail(db, owner, case)


@router.post("/claims/cases/{claim_id}/send-to-approval")
def send_claim_to_approval(claim_id: UUID, db: DB, owner: CurrentOwner):
    case = claims.get_case(db, owner, claim_id)
    action = actions.send_claim_to_approval(db, owner, case)
    db.commit()
    return {
        "case": claims.case_detail(db, owner, case),
        "action": actions.action_view(db, action),
    }


@router.post("/claims/cases/{claim_id}/sync-status")
def sync_claim_sandbox_status(claim_id: UUID, db: DB, owner: CurrentOwner):
    case = claims.get_case(db, owner, claim_id)
    res = followup.sync_claim(db, owner, case, manual=True)
    db.commit()
    return {
        "sync_result": res,
        "case": claims.case_detail(db, owner, case),
    }


@router.post("/claims/cases/{claim_id}/acknowledge-check")
def acknowledge_consistency_check(
    claim_id: UUID,
    body: AcknowledgeCheckRequest,
    db: DB,
    owner: CurrentOwner,
):
    case = claims.get_case(db, owner, claim_id)
    claims.acknowledge_check(db, owner, case, body.check_code, body.note)
    db.commit()
    return claims.case_detail(db, owner, case)


# =============================================================================
# SC-10: ACTION APPROVAL & EXECUTION
# =============================================================================


class ApproveActionRequest(BaseModel):
    payload_sha256: str
    payload_version: int = 1


class EditActionRequest(BaseModel):
    changes: dict[str, str]


@router.get("/actions/queue")
def list_action_queue(
    db: DB,
    owner: CurrentOwner,
    status_tab: str | None = None,
    q: str | None = None,
):
    query = db.query(WfActionRow).filter_by(owner_kind=owner.kind, owner_id=owner.id)
    all_actions = query.order_by(WfActionRow.created_at.desc()).all()

    counts = {
        "pending": sum(1 for a in all_actions if a.status in actions.PENDING),
        "completed": sum(1 for a in all_actions if a.status in actions.COMPLETED),
        "rejected": sum(1 for a in all_actions if a.status in actions.REJECTED),
        "all": len(all_actions),
    }

    filtered = all_actions
    if status_tab:
        tab = status_tab.upper()
        if tab == "PENDING":
            filtered = [a for a in filtered if a.status in actions.PENDING]
        elif tab == "COMPLETED":
            filtered = [a for a in filtered if a.status in actions.COMPLETED]
        elif tab == "REJECTED":
            filtered = [a for a in filtered if a.status in actions.REJECTED]

    if q:
        term = q.casefold()
        filtered = [
            a
            for a in filtered
            if term in a.reference.casefold()
            or term in a.title.casefold()
            or term in a.purpose.casefold()
        ]

    return {
        "counts": counts,
        "actions": [actions.action_view(db, a) for a in filtered],
    }


@router.get("/actions/{action_id}")
def get_action_detail(action_id: UUID, db: DB, owner: CurrentOwner):
    action = actions.get_action(db, owner, action_id)
    return actions.action_view(db, action)


@router.post("/actions/{action_id}/approve")
def approve_action(
    action_id: UUID,
    body: ApproveActionRequest,
    db: DB,
    owner: CurrentOwner,
):
    action = actions.get_action(db, owner, action_id)
    actions.approve(db, owner, action, body.payload_sha256, body.payload_version)
    db.commit()
    return actions.action_view(db, action)


@router.post("/actions/{action_id}/reject")
def reject_action(action_id: UUID, db: DB, owner: CurrentOwner):
    action = actions.get_action(db, owner, action_id)
    actions.reject(db, owner, action)
    db.commit()
    return actions.action_view(db, action)


@router.post("/actions/{action_id}/cancel")
def cancel_action(action_id: UUID, db: DB, owner: CurrentOwner):
    action = actions.get_action(db, owner, action_id)
    actions.cancel(db, owner, action)
    db.commit()
    return actions.action_view(db, action)


@router.patch("/actions/{action_id}")
def edit_action_payload(
    action_id: UUID,
    body: EditActionRequest,
    db: DB,
    owner: CurrentOwner,
):
    action = actions.get_action(db, owner, action_id)
    actions.edit_action(db, owner, action, body.changes)
    db.commit()
    return actions.action_view(db, action)


@router.post("/actions/{action_id}/execute")
def execute_action(action_id: UUID, db: DB, owner: CurrentOwner):
    action = actions.get_action(db, owner, action_id)
    receipt, replayed = actions.execute(db, owner, action)
    db.commit()
    return {
        "receipt": receipt,
        "replayed": replayed,
        "action": actions.action_view(db, action),
    }


@router.get("/actions/{action_id}/receipt")
def get_action_receipt(action_id: UUID, db: DB, owner: CurrentOwner):
    action = actions.get_action(db, owner, action_id)
    receipt = db.query(actions.WfExecutionReceiptRow).filter_by(action_id=action.id).first()
    if receipt is None:
        raise AppError(404, "NOT_FOUND", "No execution receipt for this action yet.")
    return actions.receipt_view(db, receipt)


# =============================================================================
# SC-11: ACTIVITY & AUDIT
# =============================================================================


@router.get("/audit/timeline")
def get_audit_timeline(
    db: DB,
    owner: CurrentOwner,
    category: str | None = None,
    q: str | None = None,
    status: str | None = None,
    claim_id: UUID | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    events, total = audit.query_events(
        db,
        owner,
        category=category,
        q=q,
        status=status,
        claim_id=claim_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "events": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "category": e.category,
                "title": e.title,
                "summary": e.summary,
                "actor_type": e.actor_type,
                "tool": e.tool,
                "result_status": e.result_status,
                "reason": e.reason,
                "claim_id": e.claim_id,
                "action_id": e.action_id,
                "receipt_ref": e.receipt_ref,
                "evidence_refs": e.evidence_refs or [],
                "details": e.details or {},
                "created_at": e.created_at,
            }
            for e in events
        ],
    }


@router.get("/audit/events/{event_id}")
def get_audit_event_detail(event_id: UUID, db: DB, owner: CurrentOwner):
    e = db.get(actions.WfAuditLogRow, event_id)
    if e is None or e.owner_kind != owner.kind or e.owner_id != owner.id:
        raise AppError(404, "NOT_FOUND", "Audit event not found.")
    return {
        "id": e.id,
        "event_type": e.event_type,
        "category": e.category,
        "title": e.title,
        "summary": e.summary,
        "actor_type": e.actor_type,
        "tool": e.tool,
        "result_status": e.result_status,
        "reason": e.reason,
        "claim_id": e.claim_id,
        "action_id": e.action_id,
        "receipt_ref": e.receipt_ref,
        "evidence_refs": e.evidence_refs or [],
        "details": e.details or {},
        "created_at": e.created_at,
    }


# =============================================================================
# SC-08: EMERGENCY GUIDANCE & TRIAGE
# =============================================================================


class TriageBody(BaseModel):
    text: str
    country_code: str = "CN"


@router.get("/emergency/contacts")
def get_emergency_contacts(country_code: str = "CN"):
    return emergency.get_emergency_contacts(country_code)


@router.post("/emergency/triage")
def evaluate_emergency_triage(body: TriageBody):
    return emergency.evaluate_triage(body.text, body.country_code)


# =============================================================================
# SC-15: EMPLOYER BENEFITS
# =============================================================================


@router.get("/employer-benefits/overview")
def get_employer_benefits(
    db: DB,
    owner: OptionalOwner,
    country_code: str = "CN",
):
    policies = owner_policies(db, owner) if owner else []
    target_country = (
        owner.country_code if owner and owner.country_code in ("CN", "ID") else country_code
    ) or "CN"
    return catalog_views.get_employer_benefits_overview(target_country, owner, policies)


# =============================================================================
# SC-17: PRODUCT COMPARISON
# =============================================================================


@router.get("/products/compare")
def compare_catalog_products(
    country_code: str = "CN",
    category: str | None = None,
    user_segment: str | None = None,
    insurer_id: str | None = None,
):
    return catalog_views.compare_products(
        country_code=country_code,
        product_category=category,
        user_segment=user_segment,
        insurer_id=insurer_id,
    )


# =============================================================================
# SC-19: BLOCKCHAIN DOCUMENT PROOF (BONUS)
# =============================================================================


class VerifyProofRequest(BaseModel):
    original_sha256: str
    candidate_content_base64: str | None = None
    candidate_text: str | None = None


class AnchorProofRequest(BaseModel):
    document_sha256: str
    document_title: str
    mime_type: str = "application/pdf"


@router.post("/proof/verify")
def verify_document_integrity(body: VerifyProofRequest):
    import base64

    if body.candidate_content_base64:
        content = base64.b64decode(body.candidate_content_base64)
    elif body.candidate_text is not None:
        content = body.candidate_text.encode("utf-8")
    else:
        raise AppError(422, "MISSING_CANDIDATE_DATA", "Provide candidate content to verify.")
    return proof.verify_integrity(body.original_sha256, content)


@router.post("/proof/anchor")
def anchor_document_digest(body: AnchorProofRequest, db: DB, owner: CurrentOwner):
    return proof.anchor_document_proof(
        db,
        owner,
        document_hash=body.document_sha256,
        document_title=body.document_title,
        mime_type=body.mime_type,
    )


# =============================================================================
# POLICY SERVICING (PBI US-10-06)
# =============================================================================


class ServicingDraftRequest(BaseModel):
    request_type: str
    policy_reference: str | None = None
    form_data: dict[str, str]


@router.get("/policy-servicing/types")
def list_servicing_request_types():
    return servicing.get_available_servicing_types()


@router.post("/policy-servicing/draft")
def prepare_policy_servicing_draft(body: ServicingDraftRequest, db: DB, owner: CurrentOwner):
    action = servicing.prepare_servicing_draft(
        db,
        owner,
        request_type=body.request_type,
        policy_ref=body.policy_reference,
        form_data=body.form_data,
    )
    db.commit()
    return actions.action_view(db, action)
