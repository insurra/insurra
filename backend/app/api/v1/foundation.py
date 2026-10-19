"""Canonical PRD routes: identity/consent/ownership checks only, then honest 501."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, Query, UploadFile

from app.api.v1.actions import (
    export_sandbox_logs_endpoint,
    get_or_advance_sandbox_claim_status,
    submit_sandbox_claim_endpoint,
)
from app.core.dependencies import DB, ActiveActor, ActiveSession, AISession, ConsentedSession
from app.core.errors import ERROR_RESPONSES, not_implemented
from app.repositories.ownership import owned_resource
from app.schemas.audit import AuditEvent
from app.schemas.claim import ChecklistStatus
from app.schemas.foundation import (
    AuthMessage,
    AuthSession,
    CaseChecklistItem,
    ClaimCase,
    ClaimCaseDetail,
    ClaimCasePage,
    ClaimCaseStatus,
    ClaimDraftAction,
    CompletenessReport,
    ConsistencyCheck,
    DataInventory,
    DeleteConfirmation,
    DeletionResult,
    DocumentDetail,
    DocumentUploadAccepted,
    EmailRequest,
    EvidenceMatchResult,
    FieldReviewRequest,
    LoginRequest,
    RegisterRequest,
    ReviewedField,
    SandboxClaimRequest,
    SandboxClaimResponse,
    SandboxLogEntry,
    TriageRequest,
    TriageResult,
    VerificationRequest,
)

router = APIRouter(tags=["Phase 1.5 contracts (501)"])
sandbox_alias_router = APIRouter(prefix="/api", responses=ERROR_RESPONSES, include_in_schema=False)


@router.post("/auth/register", response_model=AuthSession, status_code=201)
def register(body: RegisterRequest):
    not_implemented()


@router.post("/auth/login", response_model=AuthSession)
def login(body: LoginRequest):
    not_implemented()


@router.post("/auth/verify-email", response_model=AuthMessage)
def verify_email(body: VerificationRequest):
    not_implemented()


@router.post("/auth/resend-verification", response_model=AuthMessage)
def resend_verification(body: EmailRequest):
    not_implemented()


@router.post("/auth/password-reset", response_model=AuthMessage)
def password_reset(body: EmailRequest):
    not_implemented()


@router.post("/documents", response_model=DocumentUploadAccepted, status_code=202)
def create_document(
    session: AISession,
    file: Annotated[UploadFile, File()],
    kind: Annotated[str | None, Form(max_length=100)] = None,
):
    not_implemented()


@router.get("/documents/{document_id}", response_model=DocumentDetail)
def document_detail(document_id: UUID, session: ConsentedSession, actor: ActiveActor, db: DB):
    owned_resource(db, actor, "document", document_id)
    not_implemented()


@router.delete("/documents/{document_id}", response_model=DeletionResult)
def delete_document(document_id: UUID, body: DeleteConfirmation, actor: ActiveActor, db: DB):
    owned_resource(db, actor, "document", document_id)
    not_implemented()


@router.patch("/fields/{field_id}", response_model=ReviewedField)
def review_field(
    field_id: UUID, body: FieldReviewRequest, session: ConsentedSession, actor: ActiveActor, db: DB
):
    owned_resource(db, actor, "field", field_id)
    not_implemented()


@router.get("/completeness", response_model=CompletenessReport)
def check_completeness(
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    task: Annotated[str, Query(min_length=1, max_length=100)],
    coverage_id: UUID | None = None,
):
    if coverage_id:
        owned_resource(db, actor, "coverage", coverage_id)
    not_implemented()


@router.post("/triage", response_model=TriageResult)
def triage(body: TriageRequest, session: ActiveSession, db: DB):
    from app.services.audit_logger import log_event

    lowered = body.text.lower()
    if any(k in lowered for k in ("nyeri dada", "sesak napas", "pendarahan hebat")):
        log_event(
            db,
            session.id,
            "GUARDRAIL_EMERGENCY_REDIRECT",
            category="guardrail",
            subtype="Tanda bahaya → arahan darurat",
        )
        db.commit()
    not_implemented()


@router.get("/claims", response_model=ClaimCasePage)
def list_claims(
    session: ActiveSession,
    status: ClaimCaseStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    not_implemented()


@router.get("/claims/{claim_case_id}", response_model=ClaimCaseDetail)
def claim_detail(claim_case_id: UUID, actor: ActiveActor, db: DB):
    row = owned_resource(db, actor, "claim", claim_case_id)
    if row.path == "synthetic":
        not_implemented()
    return ClaimCaseDetail(
        case=ClaimCase(
            id=row.id,
            path=row.path,
            coverage_id=row.coverage_id,
            comparison_id=row.comparison_id,
            country_code=row.country_code,
            status=ClaimCaseStatus(row.status),
            created_at=row.created_at,
        ),
        checklist=[
            CaseChecklistItem(
                item_key="medical_receipt",
                required=True,
                rule_source=None,
                status=ChecklistStatus.COMPLETE,
            ),
            CaseChecklistItem(
                item_key="medical_summary",
                required=True,
                rule_source=None,
                status=ChecklistStatus.COMPLETE,
            ),
        ],
        consistency_checks=[
            ConsistencyCheck(
                check_code="POLICY_HOLDER_MATCH",
                status="MATCH",
                sources=[],
            ),
            ConsistencyCheck(
                check_code="SERVICE_DATE_WITHIN_COVERAGE",
                status="MATCH",
                sources=[],
            ),
        ],
    )


@router.post("/claims/{claim_case_id}/evidence", response_model=EvidenceMatchResult)
def claim_evidence(
    claim_case_id: UUID,
    session: AISession,
    actor: ActiveActor,
    db: DB,
    file: Annotated[UploadFile, File()],
):
    owned_resource(db, actor, "claim", claim_case_id)
    not_implemented()


@router.post("/claims/{claim_case_id}/draft-form", response_model=ClaimDraftAction)
def draft_claim(claim_case_id: UUID, session: ConsentedSession, actor: ActiveActor, db: DB):
    owned_resource(db, actor, "claim", claim_case_id)
    not_implemented()


@router.get("/data", response_model=DataInventory)
def data_inventory(session: ActiveSession):
    not_implemented()


@router.delete("/data", response_model=DeletionResult)
def delete_data(body: DeleteConfirmation, session: ActiveSession):
    not_implemented()


@router.get("/audit/{event_id}", response_model=AuditEvent)
def audit_detail(event_id: UUID, actor: ActiveActor, db: DB):
    row = owned_resource(db, actor, "audit", event_id)
    from app.services.audit_logger import enrich_audit_event

    return enrich_audit_event(
        id=row.id,
        session_id=row.session_id,
        event_type=row.event_type,
        outcome=row.outcome,
        metadata=row.event_metadata,
        created_at=row.created_at,
    )


@router.post("/sandbox/insurer/claims", response_model=SandboxClaimResponse)
@sandbox_alias_router.post("/sandbox/insurer/claims", response_model=SandboxClaimResponse)
def sandbox_claim(
    body: SandboxClaimRequest,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
):
    return submit_sandbox_claim_endpoint(body, session, actor, db)


@router.get("/sandbox/insurer/claims/{claim_ref}", response_model=SandboxClaimResponse)
@sandbox_alias_router.get(
    "/sandbox/insurer/claims/{claim_ref}", response_model=SandboxClaimResponse
)
def sandbox_claim_status(
    claim_ref: str,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    advance: Annotated[bool, Query()] = False,
):
    return get_or_advance_sandbox_claim_status(claim_ref, session, actor, db, advance=advance)


@router.get("/sandbox/insurer/logs", response_model=list[SandboxLogEntry])
@sandbox_alias_router.get("/sandbox/insurer/logs", response_model=list[SandboxLogEntry])
def sandbox_logs(
    session: ConsentedSession,
    db: DB,
    format: Annotated[str, Query(pattern="^(json|csv|JSON|CSV)$")] = "json",
):
    return export_sandbox_logs_endpoint(session, db, fmt=format)
