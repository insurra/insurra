from datetime import UTC, datetime

from fastapi import APIRouter

from app.core.dependencies import DB, ActiveSession
from app.models import ConsentRow
from app.schemas.session import ConsentState, ConsentUpdate
from app.services.audit_logger import log_event

router = APIRouter(prefix="/consent", tags=["Consent"])


@router.get("", response_model=ConsentState)
def get_consent(db: DB, session: ActiveSession):
    return db.get(ConsentRow, session.id)


@router.put("", response_model=ConsentState)
def update_consent(body: ConsentUpdate, db: DB, session: ActiveSession):
    row = db.get(ConsentRow, session.id)
    changed = row.processing_consent != body.processing_consent
    row.processing_consent = body.processing_consent
    row.updated_at = datetime.now(UTC)
    log_event(
        db,
        session.id,
        "CONSENT_GRANTED" if body.processing_consent else "CONSENT_REVOKED",
        processing_consent=body.processing_consent,
        changed=changed,
    )
    db.commit()
    return row
