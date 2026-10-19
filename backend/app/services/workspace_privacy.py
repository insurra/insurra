"""Transactional cleanup called from the existing account privacy boundary."""

from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import (
    AccountDocumentPageRow,
    AccountDocumentRow,
    AskLimitRow,
    ChatSessionRow,
    ClaimCaseRow,
    ClauseChunkRow,
    NotificationRow,
    PathwayDecisionRow,
    ProtectionInsightRow,
    RecommendationStateRow,
    UserPreferenceRow,
)
from app.workflow.models import (
    WfActionApprovalRow,
    WfActionExecutionRow,
    WfActionRow,
    WfAgentEventRow,
    WfAuditLogRow,
    WfClaimCaseRow,
    WfClaimDraftRow,
    WfClaimEvidenceRow,
    WfClaimItemRow,
    WfClaimStatusEventRow,
    WfExecutionReceiptRow,
    WfReminderRow,
    WfSandboxClaimRow,
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
    for model in (
        ProtectionInsightRow,
        ClaimCaseRow,
        PathwayDecisionRow,
        RecommendationStateRow,
        AskLimitRow,
        NotificationRow,
        UserPreferenceRow,
    ):
        db.execute(delete(model).where(model.account_id == account_id))
    purge_workflow(db, "ACCOUNT", account_id)


def purge_workflow(db: Session, owner_kind: str, owner_id: UUID) -> None:
    """Delete owner-scoped workflow rows. Audit rows stay but lose identifying detail."""
    claim_ids = select(WfClaimCaseRow.id).where(_owned(WfClaimCaseRow, owner_kind, owner_id))
    action_ids = select(WfActionRow.id).where(
        WfActionRow.owner_kind == owner_kind, WfActionRow.owner_id == owner_id
    )
    execution_ids = select(WfActionExecutionRow.id).where(
        WfActionExecutionRow.action_id.in_(action_ids)
    )
    db.execute(
        delete(WfExecutionReceiptRow).where(
            WfExecutionReceiptRow.owner_kind == owner_kind,
            WfExecutionReceiptRow.owner_id == owner_id,
        )
    )
    db.execute(
        delete(WfExecutionReceiptRow).where(WfExecutionReceiptRow.execution_id.in_(execution_ids))
    )
    db.execute(delete(WfActionExecutionRow).where(WfActionExecutionRow.action_id.in_(action_ids)))
    db.execute(delete(WfActionApprovalRow).where(WfActionApprovalRow.action_id.in_(action_ids)))
    db.execute(delete(WfReminderRow).where(_owned(WfReminderRow, owner_kind, owner_id)))
    db.execute(delete(WfActionRow).where(_owned(WfActionRow, owner_kind, owner_id)))
    for model in (
        WfClaimItemRow,
        WfClaimEvidenceRow,
        WfClaimDraftRow,
        WfClaimStatusEventRow,
    ):
        db.execute(delete(model).where(model.claim_id.in_(claim_ids)))
    db.execute(delete(WfClaimCaseRow).where(_owned(WfClaimCaseRow, owner_kind, owner_id)))
    db.execute(delete(WfSandboxClaimRow).where(_owned(WfSandboxClaimRow, owner_kind, owner_id)))
    db.execute(delete(WfAgentEventRow).where(_owned(WfAgentEventRow, owner_kind, owner_id)))
    db.execute(
        update(WfAuditLogRow)
        .where(_owned(WfAuditLogRow, owner_kind, owner_id))
        .values(
            summary=None,
            reason=None,
            claim_id=None,
            action_id=None,
            receipt_ref=None,
            evidence_refs=[],
            details={},
        )
    )


def _owned(model, owner_kind: str, owner_id: UUID):
    return (model.owner_kind == owner_kind) & (model.owner_id == owner_id)
