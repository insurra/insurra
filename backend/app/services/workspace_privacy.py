"""Transactional cleanup called from the existing account privacy boundary."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    AccountDocumentPageRow,
    AccountDocumentRow,
    AskLimitRow,
    ChatSessionRow,
    ClaimCaseRow,
    ClauseChunkRow,
    PathwayDecisionRow,
    RecommendationStateRow,
)


def purge_content(db: Session, account_id: UUID, *, pages=False):
    for model in (ClauseChunkRow, ChatSessionRow):
        db.execute(delete(model).where(model.account_id == account_id))
    if pages:
        ids = select(AccountDocumentRow.id).where(AccountDocumentRow.account_id == account_id)
        db.execute(
            delete(AccountDocumentPageRow).where(AccountDocumentPageRow.document_id.in_(ids))
        )


def purge_workspace(db: Session, account_id: UUID):
    purge_content(db, account_id)
    for model in (ClaimCaseRow, PathwayDecisionRow, RecommendationStateRow, AskLimitRow):
        db.execute(delete(model).where(model.account_id == account_id))
