from fastapi import APIRouter

from app.core.dependencies import ConsentedSession
from app.core.errors import not_implemented
from app.schemas.claim import Claim, ClaimDraftRequest

router = APIRouter(prefix="/claims", tags=["Claims"])


@router.post("/draft", response_model=Claim, status_code=201)
def draft(body: ClaimDraftRequest, session: ConsentedSession):
    not_implemented()
