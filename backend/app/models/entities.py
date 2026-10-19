from datetime import datetime
from uuid import UUID

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DemoSessionRow(Base):
    __tablename__ = "demo_sessions"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    persona_id: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProfileRow(Base):
    __tablename__ = "profiles"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    session_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("demo_sessions.id"), unique=True, index=True
    )
    payload: Mapped[dict] = mapped_column(JSON)


class ConsentRow(Base):
    __tablename__ = "consents"
    session_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("demo_sessions.id"), primary_key=True)
    processing_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class InsuranceRecordRow(Base):
    __tablename__ = "insurance_records"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    session_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("demo_sessions.id"), unique=True, index=True
    )
    profile_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("profiles.id"), unique=True)
    payload: Mapped[dict] = mapped_column(JSON)


class AuditRow(Base):
    __tablename__ = "audit_events"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    session_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("demo_sessions.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(100), index=True)
    outcome: Mapped[str] = mapped_column(String(30))
    event_metadata: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PersonaRow(Base):
    __tablename__ = "persona_templates"
    persona_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    description: Mapped[str] = mapped_column(String(300))
    profile_payload: Mapped[dict] = mapped_column(JSON)
    record_payload: Mapped[dict] = mapped_column(JSON)
