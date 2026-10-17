from uuid import UUID

from fastapi import APIRouter

from app.core.dependencies import ConsentedSession
from app.core.errors import not_implemented
from app.schemas.action import ProposedAction

router = APIRouter(prefix="/actions", tags=["Actions"])


@router.get("", response_model=list[ProposedAction])
def actions(session: ConsentedSession):
    not_implemented()


@router.post("/{action_id}/approve", response_model=ProposedAction)
def approve(action_id: UUID, session: ConsentedSession):
    not_implemented()


@router.post("/{action_id}/reject", response_model=ProposedAction)
def reject(action_id: UUID, session: ConsentedSession):
    not_implemented()
