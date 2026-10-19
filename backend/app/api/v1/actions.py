from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter
from pydantic import ValidationError
from sqlalchemy import select

from app.core.dependencies import DB, ActiveActor, ConsentedSession
from app.core.errors import AppError, not_implemented
from app.models import ActionRow
from app.models.foundation import ClaimCaseEventRow
from app.repositories.ownership import owned_resource
from app.schemas.action import (
    ActionDecisionResult,
    ActionPermissionLevel,
    ActionStatus,
    ProposedAction,
)
from app.schemas.foundation import ActionDecisionRequest, ClaimSubmissionPayload
from app.services.approval import payload_sha256
from app.services.audit_logger import log_event

router = APIRouter(prefix="/actions", tags=["Actions"])


@router.get("", response_model=list[ProposedAction])
def actions(session: ConsentedSession, db: DB):
    rows = db.scalars(
        select(ActionRow)
        .where(ActionRow.session_id == session.id)
        .order_by(ActionRow.created_at.desc(), ActionRow.id)
    )
    return [
        ProposedAction(
            id=row.id,
            action_type=row.type,
            status=ActionStatus(row.status),
            preview=(
                "Tinjau pengiriman klaim ke sandbox"
                if row.type == "claim_submit"
                else "Tinjau tindakan yang disiapkan"
            ),
            created_at=row.created_at,
            approved_at=row.approved_at,
            payload=row.payload,
            permission_level=(
                ActionPermissionLevel.L2 if row.type == "claim_submit" else ActionPermissionLevel.L1
            ),
            source_screen="claims",
            approved_payload_sha256=row.approved_payload_sha256,
            proposed_payload_sha256=payload_sha256(row.payload),
            payload_version=row.payload_version,
        )
        for row in rows
    ]


@router.post("/{action_id}/approve", response_model=ActionDecisionResult)
def approve(
    action_id: UUID,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    body: ActionDecisionRequest | None = None,
):
    action = owned_resource(db, actor, "action", action_id)
    if body is None or not body.confirmed:
        raise AppError(
            422, "EXPLICIT_CONFIRMATION_REQUIRED", "Konfirmasi tindakan secara eksplisit."
        )
    if body.edited_payload is not None:
        not_implemented()
    if body.expected_payload_sha256 != payload_sha256(action.payload):
        raise AppError(409, "ACTION_PAYLOAD_CHANGED", "Payload berubah setelah ditinjau.")
    if action.status != ActionStatus.PENDING.value:
        raise AppError(409, "ACTION_NOT_PENDING", "Tindakan tidak menunggu persetujuan.")
    if action.type != "claim_submit" or action.claim_case_id is None:
        not_implemented()
    try:
        payload = ClaimSubmissionPayload.model_validate(action.payload)
    except ValidationError:
        raise AppError(409, "ACTION_PAYLOAD_INVALID", "Payload tindakan tidak valid.") from None
    if payload.claim_case_id != action.claim_case_id:
        raise AppError(409, "ACTION_CONTEXT_MISMATCH", "Kasus tindakan tidak cocok.")
    claim = owned_resource(db, actor, "claim", payload.claim_case_id)
    for item in payload.attachments:
        owned_resource(db, actor, "document", item.document_id)
    action.status = ActionStatus.APPROVED.value
    action.approved_at = datetime.now(UTC)
    action.approved_payload_sha256 = payload_sha256(action.payload)
    db.add(
        ClaimCaseEventRow(
            id=uuid4(),
            session_id=session.id,
            claim_case_id=claim.id,
            event_type="ACTION_APPROVED",
            status_snapshot=claim.status,
        )
    )
    log_event(
        db,
        session.id,
        "ACTION_APPROVED",
        feature="actions",
        action_id=str(action.id),
        claim_case_id=str(claim.id),
    )
    db.commit()
    return ActionDecisionResult(status=ActionStatus.APPROVED)


@router.post("/{action_id}/reject", response_model=ActionDecisionResult)
def reject(
    action_id: UUID,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    body: ActionDecisionRequest | None = None,
):
    action = owned_resource(db, actor, "action", action_id)
    if action.status == ActionStatus.REJECTED.value:
        return ActionDecisionResult(status=ActionStatus.REJECTED)
    if action.status not in {ActionStatus.PENDING.value, ActionStatus.APPROVED.value}:
        raise AppError(409, "ACTION_NOT_REVIEWABLE", "Tindakan tidak dapat ditolak.")
    action.status = ActionStatus.REJECTED.value
    action.approved_at = None
    action.approved_payload_sha256 = None
    if action.claim_case_id is not None:
        claim = owned_resource(db, actor, "claim", action.claim_case_id)
        db.add(
            ClaimCaseEventRow(
                id=uuid4(),
                session_id=session.id,
                claim_case_id=claim.id,
                event_type="ACTION_REJECTED",
                status_snapshot=claim.status,
            )
        )
    log_event(
        db,
        session.id,
        "ACTION_REJECTED",
        feature="actions",
        action_id=str(action.id),
        claim_case_id=str(action.claim_case_id) if action.claim_case_id else None,
    )
    db.commit()
    return ActionDecisionResult(status=ActionStatus.REJECTED)
