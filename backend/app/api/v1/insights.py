"""Protection Insights API endpoints (SC-05, B2.1)."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter

from app.agent.insights import (
    InsightDecisionRequest,
    InsightList,
    ProtectionInsight,
    apply_insight_decision,
    refresh_owner_insights,
)
from app.core.dependencies import DB, KB
from app.services.actor_scope import is_demo_actor
from app.services.workspace import WorkspaceActor

router = APIRouter(tags=["Insights"])


@router.get("/insights", response_model=InsightList)
def get_insights(db: DB, actor: WorkspaceActor, kb: KB) -> InsightList:
    items = refresh_owner_insights(db, actor, kb_loader=kb)
    db.commit()
    kb_ver = items[0].kb_version if items else "1.5"
    return InsightList(
        items=items,
        kb_version=kb_ver,
        generated_at=datetime.now(UTC),
        synthetic=is_demo_actor(actor),
    )


@router.post("/insights/{insight_id}/decision", response_model=ProtectionInsight)
def post_insight_decision(
    insight_id: UUID,
    body: InsightDecisionRequest,
    db: DB,
    actor: WorkspaceActor,
) -> ProtectionInsight:
    result = apply_insight_decision(
        db,
        actor,
        insight_id,
        body.decision,
        field_id=body.field_id,
    )
    db.commit()
    return result
