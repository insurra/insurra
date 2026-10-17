from fastapi import APIRouter

from app.core.dependencies import DB, ActiveSession
from app.repositories.session_data import insurance_row
from app.schemas.insurance import UnifiedInsuranceRecord

router = APIRouter(prefix="/insurance", tags=["Insurance"])


@router.get("/record", response_model=UnifiedInsuranceRecord)
def record(db: DB, session: ActiveSession):
    return UnifiedInsuranceRecord.model_validate(insurance_row(db, session.id).payload)
