from fastapi import APIRouter

from app.core.dependencies import DB, KB
from app.schemas.user_context import UserContext
from app.services.profile_context import build_context
from app.services.workspace import WorkspaceActor

router = APIRouter(tags=["Context"])


@router.get("/context", response_model=UserContext)
def get_context(db: DB, actor: WorkspaceActor, kb: KB):
    return build_context(db, actor, kb)
