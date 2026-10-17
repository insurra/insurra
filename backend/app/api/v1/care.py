from fastapi import APIRouter

from app.core.dependencies import ConsentedSession
from app.core.errors import not_implemented
from app.schemas.care import CareComparisonRequest, CarePath

router = APIRouter(prefix="/care", tags=["Care"])


@router.post("/compare", response_model=list[CarePath])
def compare(body: CareComparisonRequest, session: ConsentedSession):
    not_implemented()
