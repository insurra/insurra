from datetime import UTC, datetime

from fastapi import APIRouter

from app.core.dependencies import DB, KB, ActiveSession
from app.repositories.session_data import profile_row
from app.schemas.profile import ProfileUpdate, UserProfile
from app.services.audit_logger import log_event
from app.services.policy_guard import PolicyGuard

router = APIRouter(prefix="/profile", tags=["Profile"])


@router.get("", response_model=UserProfile)
def profile(db: DB, session: ActiveSession):
    return UserProfile.model_validate(profile_row(db, session.id).payload)


@router.put("", response_model=UserProfile)
def update_profile(body: ProfileUpdate, db: DB, session: ActiveSession, kb: KB):
    PolicyGuard().enforce_supported_country(body.country_code, kb)
    row = profile_row(db, session.id)
    payload = {
        **row.payload,
        **body.model_dump(mode="json"),
        "updated_at": datetime.now(UTC).isoformat(),
    }
    validated = UserProfile.model_validate(payload)
    row.payload = validated.model_dump(mode="json")
    log_event(db, session.id, "PROFILE_UPDATED")
    db.commit()
    return validated
