"""Private, account-owned data for the authenticated P0 workspace."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class AccountProfileRow(Base):
    __tablename__ = "account_profiles"

    account_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True
    )
    payload: Mapped[dict] = mapped_column(JSON)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AccountConsentRow(Base):
    __tablename__ = "account_consents"
    __table_args__ = (
        UniqueConstraint("account_id", "purpose", name="uq_account_consent_purpose"),
        CheckConstraint(
            "purpose IN ('process_documents','external_ai','retention')",
            name="ck_account_consent_purpose",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    purpose: Mapped[str] = mapped_column(String(30))
    granted: Mapped[bool] = mapped_column(Boolean, default=False)
    policy_version: Mapped[str] = mapped_column(String(30))
    granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AccountDocumentRow(Base):
    __tablename__ = "account_documents"
    __table_args__ = (
        Index("uq_account_document_actor", "id", "account_id", unique=True),
        UniqueConstraint("account_id", "sha256", name="uq_account_document_hash"),
        CheckConstraint("size_bytes > 0 AND size_bytes <= 10485760", name="ck_account_doc_size"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    country_code: Mapped[str] = mapped_column(String(2))
    kind: Mapped[str] = mapped_column(String(100))
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    content: Mapped[bytes | None] = mapped_column(LargeBinary)
    language: Mapped[str | None] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(30), default="QUEUED")
    injection_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    error_code: Mapped[str | None] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AccountDocumentPageRow(Base):
    __tablename__ = "account_document_pages"
    __table_args__ = (
        UniqueConstraint("document_id", "page_no", name="uq_account_document_page"),
        CheckConstraint("page_no >= 1", name="ck_account_document_page_no"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("account_documents.id", ondelete="CASCADE"), index=True
    )
    page_no: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(String)
    ocr_used: Mapped[bool] = mapped_column(Boolean, default=False)


class AccountCoverageRow(Base):
    __tablename__ = "account_coverages"
    __table_args__ = (Index("uq_account_coverage_actor", "id", "account_id", unique=True),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("account_documents.id", ondelete="CASCADE"), unique=True
    )
    country_code: Mapped[str] = mapped_column(String(2))
    kind: Mapped[str] = mapped_column(String(100))
    provider: Mapped[str | None] = mapped_column(String(200))
    policy_number_masked: Mapped[str | None] = mapped_column(String(30))
    start_date: Mapped[str | None] = mapped_column(String(10))
    end_date: Mapped[str | None] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AccountFieldRow(Base):
    __tablename__ = "account_fields"
    __table_args__ = (
        CheckConstraint("source_page IS NULL OR source_page >= 1", name="ck_account_field_page"),
        CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="ck_account_field_confidence",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("account_documents.id", ondelete="CASCADE"), index=True
    )
    coverage_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("account_coverages.id", ondelete="SET NULL"), index=True
    )
    field_key: Mapped[str] = mapped_column(String(100))
    value: Mapped[object | None] = mapped_column(JSON)
    previous_value: Mapped[object | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(30))
    confidence: Mapped[float | None] = mapped_column()
    source_page: Mapped[int | None] = mapped_column(Integer)
    source_type: Mapped[str] = mapped_column(String(30))
    confirmed_by_user: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AccountAuditRow(Base):
    __tablename__ = "account_audit_events"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(60))
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class FamilyMemberRow(Base):
    __tablename__ = "family_members"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    relation: Mapped[str] = mapped_column(String(50))
    birth_date: Mapped[str | None] = mapped_column(String(10))
    consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
