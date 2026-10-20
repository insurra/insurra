from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError
from app.models import AccountRow, DemoSessionRow
from app.schemas.actor import Actor, ActorType
from app.schemas.consent import ConsentPurpose
from app.services.account_access import active_account
from app.services.actor_scope import actor_for, owner_for
from app.services.consents import require_purposes
from app.services.demo_access import find_demo_session, reject_ambiguous_actor
from app.services.kb_loader import CountryKBLoader

__all__ = [
    "AISession",
    "ActiveAccount",
    "ActiveActor",
    "ActiveSession",
    "ConsentedSession",
    "DB",
    "KB",
    "actor_for",
    "ai_session",
    "consent_session",
    "current_account",
    "current_actor",
    "current_session",
    "get_kb",
    "owner_for",
]

DB = Annotated[Session, Depends(get_db)]


def current_account(
    db: DB,
    authorization: Annotated[str | None, Header(max_length=300)] = None,
    x_demo_session: Annotated[str | None, Header(max_length=128)] = None,
) -> AccountRow:
    reject_ambiguous_actor(authorization, x_demo_session)
    return active_account(db, authorization)[1]


ActiveAccount = Annotated[AccountRow, Depends(current_account)]


def get_kb(request: Request) -> CountryKBLoader:
    return request.app.state.kb_loader


KB = Annotated[CountryKBLoader, Depends(get_kb)]


def current_session(
    db: DB,
    x_demo_session: Annotated[str | None, Header(max_length=128)] = None,
    authorization: Annotated[str | None, Header(max_length=300)] = None,
) -> DemoSessionRow:
    reject_ambiguous_actor(authorization, x_demo_session)
    if not x_demo_session:
        raise AppError(401, "INVALID_SESSION", "Pilih persona demo untuk memulai sesi.")
    row = find_demo_session(db, x_demo_session)
    if row is None:
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
