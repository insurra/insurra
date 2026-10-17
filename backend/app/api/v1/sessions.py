from fastapi import APIRouter, Request
from sqlalchemy import select

from app.core.dependencies import DB, KB, ActiveSession
from app.models import PersonaRow
from app.schemas.kb import CountryManifest
from app.schemas.session import DemoPersona, DemoSession, SessionCreate, SessionCreated
from app.services.demo_sessions import create_demo_session, describe_session

router = APIRouter(tags=["Demo sessions"])


@router.get("/countries", response_model=list[CountryManifest])
def countries(kb: KB):
    return kb.discover()


@router.get("/demo/personas", response_model=list[DemoPersona])
def personas(db: DB):
    return [
        DemoPersona(
            persona_id=row.persona_id,
            display_name=row.profile_payload["display_name"],
            country_code=row.profile_payload["country_code"],
            description=row.description,
        )
        for row in db.scalars(select(PersonaRow).order_by(PersonaRow.persona_id))
    ]


@router.post("/demo/sessions", response_model=SessionCreated, status_code=201)
def create_session(body: SessionCreate, db: DB, request: Request):
    return create_demo_session(db, body.persona_id, request.app.state.settings.session_ttl_hours)


@router.get("/demo/sessions/me", response_model=DemoSession)
def me(db: DB, session: ActiveSession):
    return describe_session(db, session)
