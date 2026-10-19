"""Canonical PRD routes with a limited persisted demo claim slice."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, Query, UploadFile
from sqlalchemy import func, select

from app.api.v1.actions import (
    export_sandbox_logs_endpoint,
    get_or_advance_sandbox_claim_status,
    submit_sandbox_claim_endpoint,
)
from app.core.dependencies import DB, KB, ActiveActor, ActiveSession, AISession, ConsentedSession
from app.core.errors import ERROR_RESPONSES, not_implemented
from app.models import ClaimCaseRow
from app.models.foundation import ClaimCaseEventRow
from app.repositories.ownership import owned_resource
from app.repositories.session_data import profile_row
from app.schemas.audit import AuditEvent
from app.schemas.common import CountryCode, VerificationStatus
from app.schemas.foundation import (
    AuthMessage,
    AuthSession,
    ClaimCase,
    ClaimCaseDetail,
    ClaimCaseEvent,
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
    EvidenceMatchResult,
    FieldReviewRequest,
    LoginRequest,
    PageMeta,
    RegisterRequest,
    ReviewedField,
    SandboxClaimRequest,
    SandboxClaimResponse,
    SandboxLogEntry,
    TriageRequest,
    TriageResult,
    VerificationRequest,
)
from app.schemas.kb import EmergencyDirectory
from app.services.audit_logger import enrich_audit_event

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


@router.get("/emergency", response_model=EmergencyDirectory)
def emergency_directory(country_code: CountryCode, kb: KB):
    resource = kb.load(country_code).resources.emergency
    config = resource.data
    return EmergencyDirectory(
        country_code=country_code,
        label=config.label,
        contacts=[
            contact
            for contact in config.contacts
            if resource.verification_status == VerificationStatus.VERIFIED
            and contact.verification_status == VerificationStatus.VERIFIED
        ],
    )


@router.post("/triage", response_model=TriageResult)
def triage(body: TriageRequest, session: ActiveSession, db: DB, kb: KB):
    from app.services.safety_screen import screen, to_triage_result

    country_code = body.country_code or profile_row(db, session.id).payload["country_code"]
    country = kb.load(country_code)
    # Positive phrase detection only. An unmatched text is never a medical clearance.
    return to_triage_result(screen(country, body.text, strict=False))


def claim_case_detail(row: ClaimCaseRow, db: DB) -> ClaimCaseDetail:
    # No checklist is inferred from an unverified country KB or seeded document metadata.
    events = db.scalars(
        select(ClaimCaseEventRow)
        .where(
            ClaimCaseEventRow.session_id == row.session_id,
            ClaimCaseEventRow.claim_case_id == row.id,
        )
        .order_by(ClaimCaseEventRow.created_at, ClaimCaseEventRow.id)
    )
    return ClaimCaseDetail(
        case=ClaimCase(
            id=row.id,
            path=row.path,
            coverage_id=row.coverage_id,
            country_code=row.country_code,
            status=ClaimCaseStatus(row.status),
            claim_ref=row.claim_ref,
            sandbox_status=row.sandbox_status,
            last_checked_at=row.last_checked_at,
            monitoring_state=row.monitoring_state,
            created_at=row.created_at,
        ),
        checklist=[],
        consistency_checks=[],
        timeline=[
            ClaimCaseEvent(
                id=event.id,
                event_type=event.event_type,
                status_snapshot=ClaimCaseStatus(event.status_snapshot),
                created_at=event.created_at,
            )
            for event in events
        ],
    )


@router.get("/claims", response_model=ClaimCasePage)
def list_claims(
    session: ActiveSession,
    db: DB,
    status: ClaimCaseStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    query = select(ClaimCaseRow).where(ClaimCaseRow.session_id == session.id)
    if status is not None:
        query = query.where(ClaimCaseRow.status == status.value)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(
        query.order_by(ClaimCaseRow.created_at.desc(), ClaimCaseRow.id).limit(limit).offset(offset)
    )
    return ClaimCasePage(
        items=[claim_case_detail(row, db) for row in rows],
        pagination=PageMeta(limit=limit, offset=offset, total=total),
    )


@router.get("/claims/{claim_case_id}", response_model=ClaimCaseDetail)
def claim_detail(claim_case_id: UUID, actor: ActiveActor, db: DB):
    return claim_case_detail(owned_resource(db, actor, "claim", claim_case_id), db)


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
