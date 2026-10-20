"""Content-minimizing state shared by account and demo product surfaces."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def now():
    return datetime.now(UTC)


class OwnerColumns:
    account_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    session_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("demo_sessions.id", ondelete="CASCADE"), index=True
    )


OWNER_CHECK = "(account_id IS NULL) <> (session_id IS NULL)"


class ClauseChunkRow(Base):
    """Offsets into authenticated retained pages, never a duplicate raw text store."""

    __tablename__ = "clause_chunks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "account_id"],
            ["account_documents.id", "account_documents.account_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["coverage_id", "account_id"],
            ["account_coverages.id", "account_coverages.account_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["document_id", "page_no"],
            ["account_document_pages.document_id", "account_document_pages.page_no"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("coverage_id", "document_id", "page_no", "start_offset", "end_offset"),
        CheckConstraint("page_no >= 1 AND start_offset >= 0 AND end_offset > start_offset"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    coverage_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    document_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    page_no: Mapped[int] = mapped_column(Integer)
    start_offset: Mapped[int] = mapped_column(Integer)
    end_offset: Mapped[int] = mapped_column(Integer)
    text_sha256: Mapped[str] = mapped_column(String(64))
    language: Mapped[str | None] = mapped_column(String(16), default="unknown")


class RecommendationStateRow(OwnerColumns, Base):
    __tablename__ = "recommendation_states"
    __table_args__ = (
        CheckConstraint(OWNER_CHECK),
        UniqueConstraint("account_id", "rule_id", "subject"),
        UniqueConstraint("session_id", "rule_id", "subject"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    rule_id: Mapped[str] = mapped_column(String(100))
    subject: Mapped[str] = mapped_column(String(100))
    dismissed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AskLimitRow(OwnerColumns, Base):
    __tablename__ = "ask_limits"
    __table_args__ = (
        CheckConstraint(OWNER_CHECK),
        UniqueConstraint("account_id"),
        UniqueConstraint("session_id"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    timestamps: Mapped[list] = mapped_column(JSON, default=list)
    version: Mapped[int] = mapped_column(Integer, default=0)


class ChatSessionRow(OwnerColumns, Base):
    __tablename__ = "chat_sessions"
    __table_args__ = (CheckConstraint(OWNER_CHECK),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    coverage_id: Mapped[UUID | None] = mapped_column(Uuid)
    turns: Mapped[list] = mapped_column(JSON, default=list)
    workflow_state: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PathwayDecisionRow(OwnerColumns, Base):
    __tablename__ = "pathway_decisions"
    __table_args__ = (CheckConstraint(OWNER_CHECK),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    country_code: Mapped[str] = mapped_column(String(2))
    options: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class NotificationRow(OwnerColumns, Base):
    """Event-driven notification owned by one account or demo session."""

    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(OWNER_CHECK),
        UniqueConstraint("account_id", "dedupe_key"),
        UniqueConstraint("session_id", "dedupe_key"),
        Index("ix_notifications_account_read", "account_id", "read_at"),
        Index("ix_notifications_session_read", "session_id", "read_at"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    type: Mapped[str] = mapped_column(String(60))
    category: Mapped[str] = mapped_column(String(40))
    priority: Mapped[str] = mapped_column(String(20), default="normal")
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    entity_type: Mapped[str | None] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    deep_link: Mapped[str | None] = mapped_column(String(300))
    event_source: Mapped[str] = mapped_column(String(60))
    dedupe_key: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserPreferenceRow(OwnerColumns, Base):
    __tablename__ = "user_preferences"
    __table_args__ = (
        CheckConstraint(OWNER_CHECK),
        UniqueConstraint("account_id"),
        UniqueConstraint("session_id"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    notification_settings: Mapped[dict] = mapped_column(JSON, default=dict)
    display_language: Mapped[str] = mapped_column(String(8), default="en")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ProtectionInsightRow(OwnerColumns, Base):
    """Deterministic protection insight owned by one account or demo session."""

    __tablename__ = "protection_insights"
    __table_args__ = (
        CheckConstraint(OWNER_CHECK),
        UniqueConstraint("account_id", "rule_id", "coverage_id", "input_fingerprint"),
        UniqueConstraint("session_id", "rule_id", "coverage_id", "input_fingerprint"),
        Index("ix_protection_insights_account_status", "account_id", "status"),
        Index("ix_protection_insights_session_status", "session_id", "status"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    rule_id: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(60))
    severity: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(30), default="OPEN")
    coverage_id: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(200))
    explanation: Mapped[str] = mapped_column(Text, default="")
    facts: Mapped[list] = mapped_column(JSON, default=list)
    evidence_refs: Mapped[list] = mapped_column(JSON, default=list)
    next_actions: Mapped[list] = mapped_column(JSON, default=list)
    input_fingerprint: Mapped[str] = mapped_column(String(64))
    kb_version: Mapped[str] = mapped_column(String(20), default="0.2.0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
