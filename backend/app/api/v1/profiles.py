from datetime import UTC, datetime

from fastapi import APIRouter
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from app.core.dependencies import DB, KB, ActiveSession
from app.repositories.session_data import profile_row
from app.schemas.common import VerificationStatus
from app.schemas.profile import ProfileUpdate, UserProfile
from app.schemas.profile_response import ProfileResponse
from app.services.audit_logger import log_event
from app.services.policy_guard import PolicyGuard

router = APIRouter(prefix="/profile", tags=["Profile"])


@router.get("", response_model=UserProfile)
def profile(db: DB, session: ActiveSession):
    return UserProfile.model_validate(profile_row(db, session.id).payload)


@router.put("", response_model=ProfileResponse)
def update_profile(body: ProfileUpdate, db: DB, session: ActiveSession, kb: KB):
    row = profile_row(db, session.id)
    payload = {
        **row.payload,
        **body.model_dump(mode="json", exclude_unset=True),
        "updated_at": datetime.now(UTC).isoformat(),
    }
    try:
        validated = UserProfile.model_validate(payload)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc
    PolicyGuard().enforce_supported_country(validated.country_code, kb)
    suggestions = kb.load(validated.country_code).resources.suggested_docs
    row.payload = validated.model_dump(mode="json")
    log_event(db, session.id, "PROFILE_UPDATED")
    db.commit()
    return ProfileResponse(
        profile=validated,
        suggested_docs=(
            suggestions.data[:6]
            if suggestions.verification_status == VerificationStatus.VERIFIED
            else []
        ),
    )
