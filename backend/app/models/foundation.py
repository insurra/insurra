"""Shared identities/provenance only. No extraction, claim or action workflows."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def now():
    return datetime.now(UTC)


class PurposeConsentRow(Base):
    __tablename__ = "purpose_consents"
    __table_args__ = (
        UniqueConstraint("session_id", "purpose", name="uq_consent_session_purpose"),
        CheckConstraint(
            "purpose IN ('process_documents','external_ai','retention')", name="ck_consent_purpose"
        ),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("demo_sessions.id"), index=True)
    purpose: Mapped[str] = mapped_column(String(30))
    granted: Mapped[bool] = mapped_column(Boolean, default=False)
    policy_version: Mapped[str] = mapped_column(String(30), default="1.5")
    granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DocumentRow(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("id", "session_id", name="uq_document_owner"),
        UniqueConstraint("session_id", "sha256", name="uq_document_owner_hash"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("demo_sessions.id"), index=True)
    kind: Mapped[str] = mapped_column(String(100))
    country_code: Mapped[str] = mapped_column(String(2))
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str | None] = mapped_column(String(100))
    sha256: Mapped[str | None] = mapped_column(String(64))
    storage_path: Mapped[str | None] = mapped_column(String(500))
    language: Mapped[str | None] = mapped_column(String(10))
    has_text_layer: Mapped[bool | None] = mapped_column(Boolean)
    status: Mapped[str] = mapped_column(String(30), default="QUEUED")
    injection_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ExtractedFieldRow(Base):
    __tablename__ = "extracted_fields"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "session_id"],
            ["documents.id", "documents.session_id"],
            name="fk_field_owned_document",
        ),
        CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="ck_field_confidence",
        ),
        CheckConstraint("source_page IS NULL OR source_page >= 1", name="ck_field_page"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("demo_sessions.id"), index=True)
    document_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    field_key: Mapped[str] = mapped_column(String(100))
    value: Mapped[object | None] = mapped_column(JSON)
    previous_value: Mapped[object | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(30), default="UNVERIFIED")
    confidence: Mapped[float | None] = mapped_column(Float)
    source_page: Mapped[int | None] = mapped_column(Integer)
    confirmed_by_user: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ClaimCaseRow(Base):
    __tablename__ = "claim_cases"
    __table_args__ = (UniqueConstraint("id", "session_id", name="uq_claim_owner"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("demo_sessions.id"), index=True)
    coverage_id: Mapped[UUID] = mapped_column(
        Uuid
    )  # References the session's validated JSON policy.
    country_code: Mapped[str] = mapped_column(String(2))
    path: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30), default="DRAFT")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ActionRow(Base):
    __tablename__ = "actions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["claim_case_id", "session_id"],
            ["claim_cases.id", "claim_cases.session_id"],
            name="fk_action_owned_claim",
        ),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("demo_sessions.id"), index=True)
    claim_case_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    type: Mapped[str] = mapped_column(String(50))
    payload: Mapped[dict] = mapped_column(JSON, default=dict, server_default=text("'{}'"))
    status: Mapped[str] = mapped_column(String(30), default="PENDING")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_payload_sha256: Mapped[str | None] = mapped_column(String(64))
