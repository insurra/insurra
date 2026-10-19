"""Canonical PRD routes: identity/consent/ownership checks only, then honest 501."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, Query, UploadFile

from app.core.dependencies import DB, ActiveActor, ActiveSession, AISession, ConsentedSession
from app.core.errors import AppError, not_implemented
from app.repositories.ownership import approved_action, owned_resource
from app.schemas.action import ProposedAction
from app.schemas.assessment import CoverageNeed
from app.schemas.audit import AuditEvent
from app.schemas.foundation import (
    ActionExecutionRequest,
    AskAnswer,
    AskRequest,
    AuthMessage,
    AuthSession,
    ClaimCaseCreate,
    ClaimCaseCreated,
    ClaimCaseDetail,
    ClaimCasePage,
    ClaimCaseStatus,
    ClaimDraftAction,
    CompletenessReport,
    DataInventory,
    DeleteConfirmation,
    DeletionResult,
    DocumentDetail,
    DocumentUploadAccepted,
    EmailRequest,
    EmergencyRedirect,
    EvidenceMatchResult,
    FieldReviewRequest,
    HomeSummary,
    LoginRequest,
    PathwayComparison,
    PathwayComparisonRequest,
    RegisterRequest,
    ReviewedField,
    SandboxClaimRequest,
    SandboxClaimResponse,
    TriageRequest,
    TriageResult,
    VerificationRequest,
)
from app.services.approval import payload_sha256

router = APIRouter(tags=["Phase 1.5 contracts (501)"])


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


@router.get("/home/summary", response_model=HomeSummary)
def home_summary(session: ActiveSession):
    not_implemented()


@router.post(
    "/ask",
    response_model=AskAnswer | EmergencyRedirect,
    responses={
        200: {
            "content": {
                "text/event-stream": {
                    "schema": {"type": "string"},
                    "description": "Named SSE events; data is JSON matching AskStreamEvent.",
                }
            }
        }
    },
)
def ask_policy(body: AskRequest, session: AISession, actor: ActiveActor, db: DB):
    if body.coverage_id:
        owned_resource(db, actor, "coverage", body.coverage_id)
    not_implemented()


@router.post("/pathways/compare", response_model=PathwayComparison | EmergencyRedirect)
def compare_pathways(body: PathwayComparisonRequest, session: ConsentedSession):
    not_implemented()


@router.post("/triage", response_model=TriageResult)
def triage(body: TriageRequest, session: ActiveSession):
    not_implemented()


@router.post("/claims", response_model=ClaimCaseCreated, status_code=201)
def create_claim(body: ClaimCaseCreate, session: ConsentedSession, actor: ActiveActor, db: DB):
    owned_resource(db, actor, "coverage", body.coverage_id)
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
    owned_resource(db, actor, "claim", claim_case_id)
    not_implemented()


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


@router.get("/coverage-needs", response_model=list[CoverageNeed])
def coverage_needs(session: ConsentedSession):
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


@router.post("/actions/{action_id}/execute", response_model=ProposedAction)
def execute(
    action_id: UUID,
    body: ActionExecutionRequest,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
):
    approved_action(db, actor, action_id, body.approved_payload_sha256)
    not_implemented()


@router.post("/sandbox/insurer/claims", response_model=SandboxClaimResponse)
def sandbox_claim(body: SandboxClaimRequest, session: ConsentedSession, actor: ActiveActor, db: DB):
    action = approved_action(db, actor, body.action_id, body.approved_payload_sha256)
    owned_resource(db, actor, "claim", body.claim_case_id)
    if action.claim_case_id != body.claim_case_id or action.type != "claim_submit":
        raise AppError(403, "ACTION_CONTEXT_MISMATCH", "Persetujuan tidak berlaku untuk kasus ini.")
    submitted = {
        "claim_case_id": str(body.claim_case_id),
        "attachments": [item.model_dump(mode="json") for item in body.attachments],
    }
    if payload_sha256(submitted) != action.approved_payload_sha256:
        raise AppError(403, "APPROVED_PAYLOAD_MISMATCH", "Lampiran tidak cocok dengan persetujuan.")
    for attachment in body.attachments:
        owned_resource(db, actor, "document", attachment.document_id)
    not_implemented()
