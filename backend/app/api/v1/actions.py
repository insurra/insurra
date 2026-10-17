from uuid import UUID

from fastapi import APIRouter

from app.core.dependencies import DB, ActiveActor, ConsentedSession
from app.core.errors import not_implemented
from app.repositories.ownership import owned_resource
from app.schemas.action import ActionDecisionResult, ProposedAction
from app.schemas.foundation import ActionDecisionRequest

router = APIRouter(prefix="/actions", tags=["Actions"])


@router.get("", response_model=list[ProposedAction])
def actions(session: ConsentedSession):
    not_implemented()


@router.post("/{action_id}/approve", response_model=ActionDecisionResult)
def approve(
    action_id: UUID,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    body: ActionDecisionRequest | None = None,
):
    owned_resource(db, actor, "action", action_id)
    not_implemented()


@router.post("/{action_id}/reject", response_model=ActionDecisionResult)
def reject(
    action_id: UUID,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    body: ActionDecisionRequest | None = None,
):
    owned_resource(db, actor, "action", action_id)
    not_implemented()
