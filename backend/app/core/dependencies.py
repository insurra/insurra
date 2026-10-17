import hashlib
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError
from app.models import ConsentRow, DemoSessionRow
from app.services.kb_loader import CountryKBLoader
from app.services.policy_guard import PolicyGuard

DB = Annotated[Session, Depends(get_db)]


def get_kb(request: Request) -> CountryKBLoader:
    return request.app.state.kb_loader


KB = Annotated[CountryKBLoader, Depends(get_kb)]


def current_session(
    db: DB, x_demo_session: Annotated[str | None, Header(max_length=128)] = None
) -> DemoSessionRow:
    if not x_demo_session:
        raise AppError(401, "INVALID_SESSION", "Pilih persona demo untuk memulai sesi.")
    token_hash = hashlib.sha256(x_demo_session.encode()).hexdigest()
    row = db.scalar(select(DemoSessionRow).where(DemoSessionRow.token_hash == token_hash))
    if row is None or row.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC):
        raise AppError(401, "INVALID_SESSION", "Sesi tidak valid atau sudah kedaluwarsa.")
    return row


ActiveSession = Annotated[DemoSessionRow, Depends(current_session)]


def consent_session(db: DB, session: ActiveSession) -> DemoSessionRow:
    consent = db.get(ConsentRow, session.id)
    PolicyGuard().require_active_consent(consent is not None and consent.processing_consent)
    return session


ConsentedSession = Annotated[DemoSessionRow, Depends(consent_session)]
