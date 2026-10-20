from fastapi import APIRouter
from sqlalchemy import select

from app.core.dependencies import DB, ActiveSession
from app.models import ConsentRow, PurposeConsentRow
from app.schemas.consent import ConsentPurpose, PurposeConsent, PurposeConsentUpdate
from app.schemas.session import ConsentState, ConsentUpdate
from app.services.consents import purpose_row, update_purpose

router = APIRouter(tags=["Consent"])


@router.get("/consent", response_model=ConsentState, deprecated=True)
def get_consent(db: DB, session: ActiveSession):
    """Compatibility view of process_documents only; never external_ai or retention."""
    return db.get(ConsentRow, session.id)


@router.put("/consent", response_model=ConsentState, deprecated=True)
def update_consent(body: ConsentUpdate, db: DB, session: ActiveSession):
    update_purpose(
        db,
        session.id,
        PurposeConsentUpdate(
            purpose=ConsentPurpose.PROCESS_DOCUMENTS,
            granted=body.processing_consent,
        ),
    )
    return db.get(ConsentRow, session.id)


@router.get("/consents", response_model=list[PurposeConsent])
def get_purposes(db: DB, session: ActiveSession):
    for purpose in ConsentPurpose:
        purpose_row(db, session.id, purpose)
    db.commit()
    return list(
        db.scalars(
            select(PurposeConsentRow)
            .where(
                PurposeConsentRow.session_id == session.id,
            )
            .order_by(PurposeConsentRow.purpose)
        )
    )


@router.post("/consents", response_model=PurposeConsent)
def set_purpose(body: PurposeConsentUpdate, db: DB, session: ActiveSession):
    return update_purpose(db, session.id, body)
