"""Canonical PRD routes with a limited persisted demo claim slice."""

from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, Query, UploadFile
from sqlalchemy import func, select

from app.core.dependencies import DB, KB, ActiveActor, ActiveSession, AISession, ConsentedSession
from app.core.errors import AppError, not_implemented
from app.models import ClaimCaseRow
from app.models.foundation import ClaimCaseEventRow
from app.repositories.ownership import approved_action, owned_resource
from app.repositories.session_data import insurance_row, profile_row
from app.schemas.action import ProposedAction
from app.schemas.assessment import CoverageNeed
from app.schemas.audit import AuditEvent
from app.schemas.common import CountryCode, VerificationStatus
from app.schemas.foundation import (
    ActionExecutionRequest,
    AskAnswer,
    AskRequest,
    AuthMessage,
    AuthSession,
    ClaimCase,
    ClaimCaseCreate,
    ClaimCaseCreated,
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
    EmergencyRedirect,
    EvidenceMatchResult,
    FieldReviewRequest,
    HomeSummary,
    LoginRequest,
    PageMeta,
    PathwayComparison,
    PathwayComparisonRequest,
    RegisterRequest,
    ReviewedField,
    SandboxClaimRequest,
    SandboxClaimResponse,
    TriageMatch,
    TriageRequest,
    TriageResult,
    VerificationRequest,
)
from app.schemas.kb import EmergencyDirectory
from app.services.approval import payload_sha256
from app.services.audit_logger import log_event

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
    country_code = body.country_code or profile_row(db, session.id).payload["country_code"]
    country = kb.load(country_code)
    normalized = body.text.casefold()
    matched = [
        TriageMatch(
            id=flag.id,
            kb_version=country.resources.red_flags.version,
            category=flag.category,
            source_url=flag.source_url,
        )
        for flag in country.resources.red_flags.data
        if country.resources.red_flags.verification_status == VerificationStatus.VERIFIED
        and flag.verification_status == VerificationStatus.VERIFIED
        and flag.source_url
        and any(
            phrase.casefold() in normalized
            for phrase in (*flag.phrases_id, *flag.phrases_en, *flag.phrases_zh)
        )
    ]
    flows = []
    if any(item.category == "MEDICAL" for item in matched):
        flows.append("EMERGENCY_MEDICAL")
    if any(item.category == "SELF_HARM" for item in matched):
        flows.append("SELF_HARM_SUPPORT")
    # Positive phrase detection only. An unmatched text is never a medical clearance.
    return TriageResult(red_flag=bool(matched), matched=matched, safety_flows=flows)


@router.post("/claims", response_model=ClaimCaseCreated, status_code=201)
def create_claim(body: ClaimCaseCreate, session: ConsentedSession, actor: ActiveActor, db: DB):
    owned_resource(db, actor, "coverage", body.coverage_id)
    existing = db.scalar(
        select(ClaimCaseRow).where(
            ClaimCaseRow.session_id == session.id,
            ClaimCaseRow.coverage_id == body.coverage_id,
            ClaimCaseRow.path == body.path,
            ClaimCaseRow.status == ClaimCaseStatus.DRAFT.value,
        )
    )
    if existing is not None:
        raise AppError(
            409, "CLAIM_ALREADY_EXISTS", "Kasus draf untuk perlindungan dan jalur ini sudah ada."
        )
    record = insurance_row(db, session.id)
    case = ClaimCaseRow(
        id=uuid4(),
        session_id=session.id,
        coverage_id=body.coverage_id,
        country_code=record.payload["country_code"],
        path=body.path,
        status=ClaimCaseStatus.DRAFT.value,
        monitoring_state="NOT_CONFIGURED",
    )
    db.add(case)
    db.flush()
    db.add(
        ClaimCaseEventRow(
            id=uuid4(),
            session_id=session.id,
            claim_case_id=case.id,
            event_type="CASE_CREATED",
            status_snapshot=case.status,
        )
    )
    log_event(db, session.id, "CLAIM_CREATED", feature="claims", claim_case_id=str(case.id))
    db.commit()
    return ClaimCaseCreated(claim_case_id=case.id)


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


@router.get("/coverage-needs", response_model=list[CoverageNeed])
def coverage_needs(session: ConsentedSession):
    not_implemented()


@router.get("/audit/{event_id}", response_model=AuditEvent)
def audit_detail(event_id: UUID, actor: ActiveActor, db: DB):
    owned_resource(db, actor, "audit", event_id)
    not_implemented()


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
