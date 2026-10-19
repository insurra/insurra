"""Content-minimizing state shared by account and demo product surfaces."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PathwayDecisionRow(OwnerColumns, Base):
    __tablename__ = "pathway_decisions"
    __table_args__ = (CheckConstraint(OWNER_CHECK),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    country_code: Mapped[str] = mapped_column(String(2))
    options: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
