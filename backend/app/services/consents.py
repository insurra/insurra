from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import ConsentRow, PurposeConsentRow
from app.schemas.consent import POLICY_VERSION, ConsentPurpose, PurposeConsentUpdate
from app.services.audit_logger import log_event


def initialize_consents(db: Session, session_id: UUID, timestamp: datetime) -> None:
    for purpose in ConsentPurpose:
        db.add(
            PurposeConsentRow(
                session_id=session_id,
                purpose=purpose.value,
                granted=False,
                policy_version=POLICY_VERSION,
                updated_at=timestamp,
            )
        )


def purpose_row(db: Session, session_id: UUID, purpose: ConsentPurpose) -> PurposeConsentRow:
    row = db.scalar(
        select(PurposeConsentRow).where(
            PurposeConsentRow.session_id == session_id,
            PurposeConsentRow.purpose == purpose.value,
        )
    )
    if row is None:
        raise AppError(403, "CONSENT_REQUIRED", "Persetujuan tujuan belum tersedia.")
    return row


def require_purposes(db: Session, session_id: UUID, purposes: tuple[ConsentPurpose, ...]) -> None:
    missing = [p.value for p in purposes if not purpose_row(db, session_id, p).granted]
    if missing:
        raise AppError(
            403,
            "CONSENT_REQUIRED",
            "Persetujuan tujuan pemrosesan diperlukan.",
            {"required_purposes": missing},
        )


def update_purpose(db: Session, session_id: UUID, body: PurposeConsentUpdate):
    row = purpose_row(db, session_id, body.purpose)
    changed = row.granted != body.granted
    timestamp = datetime.now(UTC)
    if changed:
        if body.granted:
            row.granted_at = timestamp
        else:
            row.revoked_at = timestamp
    row.granted = body.granted
    row.policy_version = body.policy_version
    row.updated_at = timestamp
    if body.purpose == ConsentPurpose.PROCESS_DOCUMENTS:
        legacy = db.get(ConsentRow, session_id)
        legacy.processing_consent = body.granted
        legacy.updated_at = timestamp
    log_event(
        db,
        session_id,
        "CONSENT_GRANTED" if body.granted else "CONSENT_REVOKED",
        processing_consent=body.granted
        if body.purpose == ConsentPurpose.PROCESS_DOCUMENTS
        else None,
        purpose=body.purpose.value,
        granted=body.granted,
        policy_version=body.policy_version,
        changed=changed,
    )
    db.commit()
    return row
