from fastapi import APIRouter, Request, Response
from sqlalchemy import select

from app.core.dependencies import DB, KB, ActiveSession
from app.models import PersonaRow
from app.schemas.kb import CountryManifest
from app.schemas.session import DemoPersona, DemoSession, SessionCreate, SessionCreated
from app.seeds.demo import load_persona_meta
from app.services.demo_sessions import (
    create_demo_session,
    describe_session,
    reset_demo_session,
    revoke_demo_session,
)

router = APIRouter(tags=["Demo sessions"])


@router.get("/countries", response_model=list[CountryManifest])
def countries(kb: KB):
    return kb.discover()


@router.get("/demo/personas", response_model=list[DemoPersona])
def personas(db: DB):
    result = []
    for row in db.scalars(select(PersonaRow).order_by(PersonaRow.persona_id)):
        meta = load_persona_meta(row.persona_id)
        result.append(
            DemoPersona(
                persona_id=row.persona_id,
                display_name=row.profile_payload["display_name"],
                country_code=row.profile_payload["country_code"],
                description=row.description,
                city=meta.city if meta else row.profile_payload.get("city"),
                role_label=meta.role_label if meta else None,
                insurance_categories=meta.insurance_categories if meta else [],
            )
        )
    return result


@router.post("/demo/sessions", response_model=SessionCreated, status_code=201)
def create_session(body: SessionCreate, db: DB, request: Request):
    return create_demo_session(db, body.persona_id, request.app.state.settings.session_ttl_hours)


@router.get("/demo/sessions/me", response_model=DemoSession)
def me(db: DB, session: ActiveSession):
    return describe_session(db, session)


@router.delete("/demo/sessions/me", status_code=204)
def end_session(db: DB, session: ActiveSession):
    revoke_demo_session(db, session)
    return Response(status_code=204)


@router.post("/demo/sessions/me/reset", response_model=SessionCreated, status_code=201)
def reset_session(db: DB, session: ActiveSession, request: Request):
    return reset_demo_session(db, session, request.app.state.settings.session_ttl_hours)
