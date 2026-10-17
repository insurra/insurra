from fastapi import APIRouter

from app.core.dependencies import DB, KB, ActiveSession, ConsentedSession
from app.core.errors import not_implemented
from app.repositories.session_data import insurance_row, profile_row
from app.schemas.assessment import CompletenessItem, CoverageNeed, VisaCoverageAssessment
from app.schemas.insurance import UnifiedInsuranceRecord
from app.schemas.profile import UserProfile
from app.services.audit_logger import log_event
from app.services.rules_engine import RulesEngine

router = APIRouter(prefix="/assessments", tags=["Assessments"])


@router.get("/visa-gap", response_model=VisaCoverageAssessment)
def visa_gap(db: DB, kb: KB, session: ActiveSession):
    result = RulesEngine(kb).assess_visa_coverage(
        UserProfile.model_validate(profile_row(db, session.id).payload),
        UnifiedInsuranceRecord.model_validate(insurance_row(db, session.id).payload),
    )
    log_event(
        db,
        session.id,
        "VISA_GAP_ASSESSED",
        assessment_status=result.assessment_status.value,
        gap_days=result.gap_days,
    )
    db.commit()
    return result


@router.get("/completeness", response_model=list[CompletenessItem])
def completeness(session: ConsentedSession):
    not_implemented()


@router.get("/coverage-needs", response_model=list[CoverageNeed])
def coverage_needs(session: ConsentedSession):
    not_implemented()
