"""Canonical Valen operations with the existing account or demo identity."""

from fastapi import APIRouter

from app.core.dependencies import DB, KB
from app.schemas.assessment import CoverageNeed
from app.schemas.foundation import (
    EmergencyRedirect,
    HomeSummary,
    PathwayComparison,
    PathwayComparisonRequest,
)
from app.schemas.valen import RecommendationDecision, SavedDecision
from app.services.care_pathways import compare
from app.services.command_center import save_recommendation, summary
from app.services.coverage_matching import match_needs
from app.services.workspace import WorkspaceActor, require_grants

router = APIRouter(tags=["Valen workspace"])


@router.get("/home/summary", response_model=HomeSummary)
def home_summary(db: DB, kb: KB, actor: WorkspaceActor):
    return summary(db, actor, kb)


@router.post("/home/recommendations/decision", response_model=SavedDecision)
def recommendation_decision(body: RecommendationDecision, db: DB, kb: KB, actor: WorkspaceActor):
    save_recommendation(db, actor, kb, body)
    return SavedDecision()


@router.get("/coverage-needs", response_model=list[CoverageNeed])
def coverage_needs(db: DB, kb: KB, actor: WorkspaceActor):
    require_grants(db, actor)
    return match_needs(db, actor, kb)


@router.post("/pathways/compare", response_model=PathwayComparison | EmergencyRedirect)
def compare_pathways(body: PathwayComparisonRequest, db: DB, kb: KB, actor: WorkspaceActor):
    return compare(db, actor, kb, body)
