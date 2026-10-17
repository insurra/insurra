import hashlib
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError
from app.models import DemoSessionRow
from app.schemas.actor import Actor, ActorType
from app.schemas.consent import ConsentPurpose
from app.services.consents import require_purposes
from app.services.kb_loader import CountryKBLoader

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
    require_purposes(db, session.id, (ConsentPurpose.PROCESS_DOCUMENTS,))
    return session


ConsentedSession = Annotated[DemoSessionRow, Depends(consent_session)]


def ai_session(db: DB, session: ActiveSession) -> DemoSessionRow:
    require_purposes(db, session.id, (ConsentPurpose.PROCESS_DOCUMENTS, ConsentPurpose.EXTERNAL_AI))
    return session


AISession = Annotated[DemoSessionRow, Depends(ai_session)]


def current_actor(session: ActiveSession) -> Actor:
    return Actor(actor_type=ActorType.DEMO_SESSION, session_id=session.id)


ActiveActor = Annotated[Actor, Depends(current_actor)]
