from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import InsuranceRecordRow, ProfileRow
from app.services.policy_guard import PolicyGuard


def scoped_row(db: Session, model, session_id: UUID):
    row = db.scalar(select(model).where(model.session_id == session_id))
    if row is None:
        raise AppError(404, "SESSION_DATA_NOT_FOUND", "Data sesi tidak ditemukan.")
    PolicyGuard().validate_session_access(session_id, row.session_id)
    return row


def profile_row(db: Session, session_id: UUID) -> ProfileRow:
    return scoped_row(db, ProfileRow, session_id)


def insurance_row(db: Session, session_id: UUID) -> InsuranceRecordRow:
    return scoped_row(db, InsuranceRecordRow, session_id)
