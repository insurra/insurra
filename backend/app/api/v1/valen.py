"""Canonical Valen operations with the existing account or demo identity."""

from fastapi import APIRouter

from app.core.dependencies import DB, KB
from app.schemas.foundation import HomeSummary
from app.schemas.valen import RecommendationDecision, SavedDecision
from app.services.command_center import save_recommendation, summary
from app.services.workspace import WorkspaceActor

router = APIRouter(tags=["Valen workspace"])


@router.get("/home/summary", response_model=HomeSummary)
def home_summary(db: DB, kb: KB, actor: WorkspaceActor):
    return summary(db, actor, kb)


@router.post("/home/recommendations/decision", response_model=SavedDecision)
def recommendation_decision(body: RecommendationDecision, db: DB, kb: KB, actor: WorkspaceActor):
    save_recommendation(db, actor, kb, body)
    return SavedDecision()
