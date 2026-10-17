import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import ConsentRow, DemoSessionRow, InsuranceRecordRow, PersonaRow, ProfileRow
from app.schemas.insurance import UnifiedInsuranceRecord
from app.schemas.profile import UserProfile
from app.schemas.session import DemoSession, SessionCreated
from app.services.audit_logger import log_event


def describe_session(db: Session, row: DemoSessionRow) -> DemoSession:
    from app.repositories.session_data import profile_row

    profile = profile_row(db, row.id)
    return DemoSession(
        id=row.id,
        persona_id=row.persona_id,
        profile_id=profile.id,
        created_at=row.created_at,
        expires_at=row.expires_at,
    )


def create_demo_session(db: Session, persona_id: str, ttl_hours: int) -> SessionCreated:
    template = db.get(PersonaRow, persona_id)
    if template is None:
        raise AppError(404, "PERSONA_NOT_FOUND", "Persona tidak ditemukan. Jalankan make seed.")
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
    log_event(db, session.id, "SESSION_CREATED")
    db.commit()
    return SessionCreated(**describe_session(db, session).model_dump(), session_token=token)
