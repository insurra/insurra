"""Canonical workspace operations with the existing account or demo identity."""

from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Header
from sqlalchemy import select

from app.agent.protection_review import get_latest_assessment, run_protection_review
from app.core.dependencies import DB, KB
from app.core.errors import AppError
from app.models import ClaimCaseRow
from app.models.foundation import ClaimCaseEventRow
from app.repositories.ownership import owned_resource
from app.repositories.session_data import insurance_row
from app.schemas.assessment import CoverageNeed
from app.schemas.foundation import (
    AntiLapseAgentStatus,
    ClaimCaseCreate,
    ClaimCaseCreated,
    ClaimCaseStatus,
    EmergencyRedirect,
    HomeSummary,
    PathwayComparison,
    PathwayComparisonRequest,
)
from app.schemas.protection_plan import (
    AssessmentRunRequest,
    PersonalProtectionPlan,
    ProtectionAssessmentDetail,
)
from app.schemas.workspace import RecommendationDecision, SavedDecision
from app.services.actor_scope import owner_for
from app.services.audit_logger import log_event
from app.services.care_pathways import compare
from app.services.command_center import save_recommendation, summary
from app.services.coverage_matching import match_needs
from app.services.pathway_cases import create_case
from app.services.protection_plan import build_protection_plan
from app.services.workspace import WorkspaceActor, require_grants

router = APIRouter(tags=["Workspace"])


@router.get("/home/summary", response_model=HomeSummary)
def home_summary(db: DB, kb: KB, actor: WorkspaceActor):
    return summary(db, actor, kb)


@router.get("/agent/anti-lapse/status", response_model=AntiLapseAgentStatus)
def get_anti_lapse_agent_status(db: DB, actor: WorkspaceActor):
    from app.services.anti_lapse_agent import run_anti_lapse_agent

    owner = owner_for(actor)
    return run_anti_lapse_agent(db, owner, actor=actor, force_scan=False)


@router.post("/agent/anti-lapse/scan", response_model=AntiLapseAgentStatus)
def trigger_anti_lapse_agent_scan(db: DB, actor: WorkspaceActor):
    from app.services.anti_lapse_agent import run_anti_lapse_agent

    owner = owner_for(actor)
    res = run_anti_lapse_agent(db, owner, actor=actor, force_scan=True)
    db.commit()
    return res


@router.post("/home/recommendations/decision", response_model=SavedDecision)
def recommendation_decision(body: RecommendationDecision, db: DB, kb: KB, actor: WorkspaceActor):
    save_recommendation(db, actor, kb, body)
    return SavedDecision()


@router.get("/coverage-needs", response_model=list[CoverageNeed])
def coverage_needs(db: DB, kb: KB, actor: WorkspaceActor):
    require_grants(db, actor)
    return match_needs(db, actor, kb)


@router.get("/protection-plan", response_model=PersonalProtectionPlan)
def protection_plan(db: DB, kb: KB, actor: WorkspaceActor):
    return build_protection_plan(db, actor, kb)


@router.get("/protection-assessment", response_model=ProtectionAssessmentDetail)
def protection_assessment(db: DB, actor: WorkspaceActor):
    owner = owner_for(actor)
    return get_latest_assessment(db, owner)


@router.post("/protection-assessment/run", response_model=ProtectionAssessmentDetail)
def run_protection_assessment(body: AssessmentRunRequest, db: DB, actor: WorkspaceActor):
    owner = owner_for(actor)
    run_protection_review(db, owner, trigger_reason=body.trigger_reason, force=body.force)
    return get_latest_assessment(db, owner)


@router.post("/pathways/compare", response_model=PathwayComparison | EmergencyRedirect)
def compare_pathways(body: PathwayComparisonRequest, db: DB, kb: KB, actor: WorkspaceActor):
    return compare(db, actor, kb, body)


@router.post("/claims", response_model=ClaimCaseCreated, status_code=201)
def create_claim_case(
    body: ClaimCaseCreate,
    db: DB,
    kb: KB,
    actor: WorkspaceActor,
    idempotency_key: Annotated[str | None, Header()] = None,
):
    if actor.session_id and body.path == "manual" and body.comparison_id is None:
        require_grants(db, actor)
        owned_resource(db, actor, "coverage", body.coverage_id)
        existing = db.scalar(
            select(ClaimCaseRow).where(
                ClaimCaseRow.session_id == actor.session_id,
                ClaimCaseRow.coverage_id == body.coverage_id,
                ClaimCaseRow.path == body.path,
                ClaimCaseRow.status == ClaimCaseStatus.DRAFT.value,
            )
        )
        if existing is not None:
            raise AppError(409, "CLAIM_ALREADY_EXISTS", "A draft already exists for this coverage.")
        record = insurance_row(db, actor.session_id)
        case = ClaimCaseRow(
            id=uuid4(),
            session_id=actor.session_id,
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
                session_id=actor.session_id,
                claim_case_id=case.id,
                event_type="CASE_CREATED",
                status_snapshot=case.status,
            )
        )
        log_event(
            db, actor.session_id, "CLAIM_CREATED", feature="claims", claim_case_id=str(case.id)
        )
        db.commit()
        return ClaimCaseCreated(claim_case_id=case.id)
    return ClaimCaseCreated(claim_case_id=create_case(db, actor, kb, body, idempotency_key))
