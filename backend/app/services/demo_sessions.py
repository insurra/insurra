import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.core.errors import AppError
from app.models import ConsentRow, DemoSessionRow, InsuranceRecordRow, PersonaRow, ProfileRow
from app.schemas.actor import Actor, ActorType
from app.schemas.insurance import UnifiedInsuranceRecord
from app.schemas.profile import UserProfile
from app.schemas.session import DemoSession, SessionCreated
from app.services.audit_logger import log_event
from app.services.consents import initialize_consents


def describe_session(db: Session, row: DemoSessionRow) -> DemoSession:
    from app.repositories.session_data import profile_row

    profile = profile_row(db, row.id)
    return DemoSession(
        id=row.id,
        persona_id=row.persona_id,
        profile_id=profile.id,
        created_at=row.created_at,
        expires_at=row.expires_at,
        actor=Actor(actor_type=ActorType.DEMO_SESSION, session_id=row.id),
    )


def _owned_condition(table, ids):
    """Row filter selecting demo-owned rows, following claim/action parents for child tables."""
    columns = table.c
    if "session_id" in columns and any(
        fk.column.table.name == "demo_sessions" for fk in columns.session_id.foreign_keys
    ):
        return columns.session_id.in_(ids)
    if "owner_id" in columns and "owner_kind" in columns:
        return and_(columns.owner_kind == "DEMO", columns.owner_id.in_(ids))
    for fk in table.foreign_keys:
        parent = fk.column.table
        if parent.name in ("wf_claim_cases", "wf_actions"):
            return fk.parent.in_(select(parent.c.id).where(_owned_condition(parent, ids)))
    return None


def purge_demo_sessions(db: Session, session_ids: list) -> None:
    """Delete demo sessions and every row they own, children before parents.

    Foundation tables reference demo_sessions without ON DELETE CASCADE and the wf_* tables
    carry no foreign key to the session, so ownership is resolved explicitly.
    """
    import app.workflow.models  # noqa: F401  (register wf_* tables on Base.metadata)

    for start in range(0, len(session_ids), 400):
        ids = session_ids[start : start + 400]
        for table in reversed(Base.metadata.sorted_tables):
            if table.name == "demo_sessions":
                continue
            condition = _owned_condition(table, ids)
            if condition is not None:
                db.execute(delete(table).where(condition))
        db.execute(delete(DemoSessionRow).where(DemoSessionRow.id.in_(ids)))
    db.flush()


def purge_dead_sessions(db: Session) -> int:
    """Opportunistically remove expired or revoked demo sessions with all their data."""
    now = datetime.now(UTC)
    ids = list(
        db.scalars(
            select(DemoSessionRow.id).where(
                or_(DemoSessionRow.expires_at <= now, DemoSessionRow.revoked_at.is_not(None))
            )
        )
    )
    if ids:
        purge_demo_sessions(db, ids)
        db.commit()
    return len(ids)


def revoke_demo_session(db: Session, session: DemoSessionRow) -> None:
    session.revoked_at = datetime.now(UTC)
    log_event(db, session.id, "SESSION_REVOKED")
    db.commit()


def reset_demo_session(db: Session, session: DemoSessionRow, ttl_hours: int) -> SessionCreated:
    persona_id = session.persona_id
    if db.get(PersonaRow, persona_id) is None:
        raise AppError(404, "PERSONA_NOT_FOUND", "Persona tidak ditemukan. Jalankan make seed.")
    session.revoked_at = datetime.now(UTC)
    db.commit()
    return create_demo_session(db, persona_id, ttl_hours)


def create_demo_session(db: Session, persona_id: str, ttl_hours: int) -> SessionCreated:
    template = db.get(PersonaRow, persona_id)
    if template is None:
        raise AppError(404, "PERSONA_NOT_FOUND", "Persona tidak ditemukan. Jalankan make seed.")
    purge_dead_sessions(db)
    now = datetime.now(UTC)
    token = secrets.token_urlsafe(32)
    session = DemoSessionRow(
        id=uuid4(),
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        persona_id=persona_id,
        created_at=now,
        expires_at=now + timedelta(hours=ttl_hours),
    )
    db.add(session)
    db.flush()
    profile_data = dict(template.profile_payload)
    profile_data.update(id=str(uuid4()), created_at=now.isoformat(), updated_at=now.isoformat())
    profile = UserProfile.model_validate(profile_data)
    db.add(
        ProfileRow(id=profile.id, session_id=session.id, payload=profile.model_dump(mode="json"))
    )
    db.flush()
    original = UnifiedInsuranceRecord.model_validate(template.record_payload)
    # All fixture identifiers are replaced, including policy and document references.
    identifiers = {str(original.id): str(uuid4()), str(original.profile_id): str(profile.id)}
    identifiers.update({str(p.id): str(uuid4()) for p in original.policies})
    identifiers.update({str(d.id): str(uuid4()) for d in original.documents})

    def remap(value):
        if isinstance(value, dict):
            return {k: remap(v) for k, v in value.items()}
        if isinstance(value, list):
            return [remap(v) for v in value]
        return identifiers.get(value, value) if isinstance(value, str) else value

    payload = remap(original.model_dump(mode="json"))
    payload["updated_at"] = now.isoformat()
    record = UnifiedInsuranceRecord.model_validate(payload)
    db.add(
        InsuranceRecordRow(
            id=record.id,
            session_id=session.id,
            profile_id=profile.id,
            payload=record.model_dump(mode="json"),
        )
    )
    db.add(ConsentRow(session_id=session.id, processing_consent=False, updated_at=now))
    initialize_consents(db, session.id, now)
    log_event(db, session.id, "SESSION_CREATED")
    db.commit()

    # Seed realistic demo claim cases, actions and audit events from KB for demo session
    from app.seeds.demo_claims_seed import seed_demo_claims_for_session

    seed_demo_claims_for_session(
        db,
        session.id,
        country_code=profile.country_code,
        persona_name=profile.display_name or "Demo User",
    )

    return SessionCreated(**describe_session(db, session).model_dump(), session_token=token)
