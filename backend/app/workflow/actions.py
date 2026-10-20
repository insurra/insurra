"""Action boundary: prepare, approve, edit, reject, cancel and execute with exact-payload approval.

The model never executes anything. Execution re-verifies owner, consent, approval, payload hash,
version, destination and expiry on the server for every call.
"""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.services.approval import payload_sha256
from app.services.events import dispatch
from app.workflow import audit, claims, executors, sandbox, states
from app.workflow.models import (
    WfActionApprovalRow,
    WfActionExecutionRow,
    WfActionRow,
    WfClaimCaseRow,
    WfExecutionReceiptRow,
    WfReminderRow,
)
from app.workflow.owner import Owner, require_purpose

APPROVAL_TTL = timedelta(hours=24)
RATE_LIMIT_PER_MINUTE = 10

ACTION_TYPES: dict[str, dict] = {
    "claim_form_preparation": {
        "label": "Prepare claim draft",
        "destination": "insurra_internal",
        "environment": "INTERNAL",
        "approval": False,
        "editable": [],
    },
    "sandbox_claim_submit": {
        "label": "Submit claim to insurer sandbox",
        "destination": "insurer_sandbox",
        "environment": "SANDBOX",
        "approval": True,
        "editable": [],
    },
    "insurance_inquiry_draft": {
        "label": "Insurance inquiry draft",
        "destination": "manual_handoff",
        "environment": "MANUAL_HANDOFF",
        "approval": True,
        "editable": ["subject", "body"],
    },
    "renewal_inquiry": {
        "label": "Renewal inquiry draft",
        "destination": "manual_handoff",
        "environment": "MANUAL_HANDOFF",
        "approval": True,
        "editable": ["subject", "body"],
    },
    "policy_servicing_request": {
        "label": "Policy servicing request draft",
        "destination": "manual_handoff",
        "environment": "MANUAL_HANDOFF",
        "approval": True,
        "editable": ["subject", "body"],
    },
    "policy_clarification_inquiry": {
        "label": "Policy clarification inquiry draft",
        "destination": "manual_handoff",
        "environment": "MANUAL_HANDOFF",
        "approval": True,
        "editable": ["subject", "body"],
    },
    "employer_benefit_inquiry": {
        "label": "Employer benefit inquiry draft",
        "destination": "manual_handoff",
        "environment": "MANUAL_HANDOFF",
        "approval": True,
        "editable": ["subject", "body"],
    },
    "claim_follow_up_message": {
        "label": "Claim follow-up message draft",
        "destination": "manual_handoff",
        "environment": "MANUAL_HANDOFF",
        "approval": True,
        "editable": ["subject", "body"],
    },
    "claim_dispute_appeal": {
        "label": "Claim clarification & appeal draft",
        "destination": "manual_handoff",
        "environment": "MANUAL_HANDOFF",
        "approval": True,
        "editable": ["subject", "body"],
    },
    "calendar_reminder_file": {
        "label": "Calendar reminder file (.ics)",
        "destination": "manual_handoff",
        "environment": "MANUAL_HANDOFF",
        "approval": True,
        "editable": ["title", "detail", "due_date"],
    },
    "internal_reminder": {
        "label": "Set reminder",
        "destination": "insurra_internal",
        "environment": "INTERNAL",
        "approval": True,
        "editable": ["title", "detail", "due_date"],
    },
}
ALLOWED_DESTINATIONS = {name: {meta["destination"]} for name, meta in ACTION_TYPES.items()}
PENDING = ("DRAFT", "AWAITING_APPROVAL", "APPROVED")
COMPLETED = ("COMPLETED", "HANDOFF_READY")
REJECTED = ("REJECTED", "CANCELLED", "EXPIRED")


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    return None if value is None else value.replace(tzinfo=UTC) if value.tzinfo is None else value


def get_action(db: Session, owner: Owner, action_id: UUID) -> WfActionRow:
    action = db.get(WfActionRow, action_id)
    if action is None or action.owner_kind != owner.kind or action.owner_id != owner.id:
        raise AppError(404, "NOT_FOUND", "Action not found.")
    return action


def _reference(db: Session, owner: Owner) -> str:
    count = (
        db.scalar(
            select(func.count())
            .select_from(WfActionRow)
            .where(WfActionRow.owner_kind == owner.kind, WfActionRow.owner_id == owner.id)
        )
        or 0
    )
    return f"ACT-{_now().year}-{count + 1:03d}"


def prepare_action(
    db: Session,
    owner: Owner,
    action_type: str,
    *,
    title: str,
    purpose: str,
    payload: dict,
    claim: WfClaimCaseRow | None = None,
    dedupe_base: str | None = None,
    permissions: list[str] | None = None,
) -> WfActionRow:
    meta = ACTION_TYPES.get(action_type)
    if meta is None:
        raise AppError(422, "UNSUPPORTED_ACTION_TYPE", "This action type is not supported.")
    digest = payload_sha256(payload)
    dedupe_key = f"{dedupe_base}:{digest[:16]}" if dedupe_base else None
    if dedupe_key:
        existing = db.scalar(
            select(WfActionRow).where(
                WfActionRow.owner_kind == owner.kind,
                WfActionRow.owner_id == owner.id,
                WfActionRow.dedupe_key == dedupe_key,
            )
        )
        if existing is not None and existing.status in (
            "AWAITING_APPROVAL",
            "APPROVED",
            "COMPLETED",
            "HANDOFF_READY",
        ):
            return existing
        if existing is not None:
            dedupe_key = f"{dedupe_key}:{uuid4().hex[:6]}"
    default_perms = (
        []
        if action_type in ("internal_reminder", "calendar_reminder_file")
        else ["process_documents"]
    )
    action = WfActionRow(
        owner_kind=owner.kind,
        owner_id=owner.id,
        reference=_reference(db, owner),
        claim_id=claim.id if claim else None,
        action_type=action_type,
        title=title[:200],
        purpose=purpose[:500],
        destination=meta["destination"],
        environment=meta["environment"],
        payload=payload,
        payload_sha256=digest,
        payload_version=1,
        status="AWAITING_APPROVAL" if meta["approval"] else "DRAFT",
        required_permissions=permissions if permissions is not None else default_perms,
        expires_at=_now() + APPROVAL_TTL if meta["approval"] else None,
        dedupe_key=dedupe_key,
        ai_prepared=True,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(action)
    db.flush()
    audit.record(
        db,
        owner,
        "ACTION_PREPARED",
        "ACTIONS",
        f"{meta['label']} prepared",
        summary=f"INSURRA prepared '{meta['label']}'. {'It needs your approval before anything runs.' if meta['approval'] else 'It stays inside INSURRA.'}",
        actor_type="AI_PREPARED",
        tool="prepare_action",
        action_id=action.id,
        claim_id=claim.id if claim else None,
        details={
            "action_type": action_type,
            "action_reference": action.reference,
            "environment": action.environment,
            "destination": action.destination,
            "claim_reference": claim.reference if claim else "",
        },
    )
    audit.agent_event(
        db, owner, "prepare_action", "OK", claim.id if claim else None, {"action_type": action_type}
    )
    dispatch(db, owner, "action.prepared", action.id, {"status": action.status})
    return action


def prepare_user_action(
    db: Session,
    owner: Owner,
    action_type: str,
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
    draft_inputs: dict | None = None,
    title: str | None = None,
    purpose: str | None = None,
    dedupe_key: str | None = None,
) -> WfActionRow:
    if action_type not in ACTION_TYPES:
        raise AppError(422, "UNSUPPORTED_ACTION_TYPE", "This action type is not supported.")
    built_title, built_purpose, payload, claim_case = executors.build_action_payload(
        db,
        owner,
        action_type,
        entity_type=entity_type,
        entity_id=entity_id,
        draft_inputs=draft_inputs,
        title_override=title,
        purpose_override=purpose,
    )
    base_dedupe = dedupe_key or f"user_action:{action_type}:{entity_id or 'none'}"
    return prepare_action(
        db,
        owner,
        action_type,
        title=built_title,
        purpose=built_purpose,
        payload=payload,
        claim=claim_case,
        dedupe_base=base_dedupe,
    )


def build_submission_payload(db: Session, owner: Owner, case: WfClaimCaseRow) -> dict:
    draft = claims.case_draft(db, case)
    rows = claims.case_evidence(db, case)
    policy = claims.owner_policy(db, owner, case.coverage_ref)
    form = {k: v["value"] for k, v in (draft.form if draft else {}).items()}
    return {
        "schema": "sandbox_claim.v1",
        "claim_reference": case.reference,
        "claim_type": case.claim_type,
        "country_code": case.country_code,
        "product_id": case.product_id,
        "pathway_mode": claims.pathway_mode(case.country_code, case.product_id),
        "claimant": form.get("member_name"),
        "policy": {
            "reference": form.get("policy_reference"),
            "insurer": form.get("insurer"),
            "start": case.policy_start,
            "end": case.policy_end,
            "label": policy.name if policy else None,
        },
        "service": {"date": form.get("visit_date"), "provider": form.get("provider_name")},
        "amount": {"value": form.get("total_claim_amount"), "currency": form.get("currency")},
        "diagnosis": form.get("diagnosis"),
        "attachments": [
            {
                "evidence_id": str(r.id),
                "evidence_kind": r.evidence_kind,
                "filename": r.filename,
                "sha256": r.sha256,
            }
            for r in rows
        ],
    }


def send_claim_to_approval(db: Session, owner: Owner, case: WfClaimCaseRow) -> WfActionRow:
    require_purpose(db, owner, "process_documents")
    if claims.pathway_mode(case.country_code, case.product_id) != "REIMBURSEMENT":
        raise AppError(
            409,
            "NOT_A_REIMBURSEMENT_CLAIM",
            "Public scheme pathways do not use the private claim submission flow.",
        )
    detail = claims.recompute(db, owner, case, source="SYSTEM")
    if case.status != states.READY_FOR_APPROVAL:
        raise AppError(
            409,
            "CLAIM_NOT_READY",
            "The claim must be Ready for Approval before it can be sent for approval.",
            {"status": case.status},
        )
    del detail
    payload = build_submission_payload(db, owner, case)
    action = prepare_action(
        db,
        owner,
        "sandbox_claim_submit",
        title="Submit claim to insurer (sandbox)",
        purpose="Send the prepared claim form and attached documents to the insurer sandbox for review.",
        payload=payload,
        claim=case,
        dedupe_base=f"claim_submit:{case.id}",
    )
    states.transition(
        db,
        case,
        states.AWAITING_APPROVAL,
        source="USER",
        note="Draft sent to approval",
        event_type="SENT_TO_APPROVAL",
    )
    audit.record(
        db,
        owner,
        "CLAIM_SENT_TO_APPROVAL",
        "CLAIMS",
        "Claim draft sent to approval",
        summary=f"{case.reference} is waiting for your approval. Nothing was submitted.",
        actor_type="USER",
        claim_id=case.id,
        action_id=action.id,
        details={"claim_reference": case.reference, "action_reference": action.reference},
    )
    return action


def _lifecycle_status(
    action: WfActionRow,
    latest_exec: WfActionExecutionRow | None,
) -> tuple[str, dict]:
    """Map internal action + execution state to canonical PENDING/APPROVED/EXECUTING/SUCCEEDED/FAILED."""
    exec_status = latest_exec.status if latest_exec else None
    error_code = latest_exec.error_code if latest_exec else None
    if exec_status == "RUNNING" or action.status == "EXECUTING":
        canonical = "EXECUTING"
        summary = "Execution is currently in progress."
    elif action.status == "FAILED" or exec_status == "FAILED":
        canonical = "FAILED"
        summary = (
            f"Execution failed ({error_code}). No external submission was completed."
            if error_code
            else "Execution failed. No external submission was completed."
        )
    elif action.status in COMPLETED or exec_status == "SUCCEEDED":
        canonical = "SUCCEEDED"
        summary = (
            "Approved draft prepared for manual handoff."
            if action.environment == "MANUAL_HANDOFF"
            else "Execution succeeded and receipt was recorded."
        )
    elif action.status == "APPROVED":
        canonical = "APPROVED"
        summary = "Approved and bound to payload SHA-256. Ready to execute."
    elif action.status in ("AWAITING_APPROVAL", "DRAFT", "PENDING"):
        canonical = "PENDING"
        summary = "Waiting for user review and approval."
    else:
        canonical = "REJECTED"
        summary = f"Action ended with status {action.status}."
    return canonical, {
        "lifecycle_status": canonical,
        "raw_status": action.status,
        "execution_status": exec_status,
        "error_code": error_code,
        "summary": summary,
    }


def action_view(db: Session, action: WfActionRow) -> dict:
    case = db.get(WfClaimCaseRow, action.claim_id) if action.claim_id else None
    approval = latest_valid_approval(db, action)
    receipt = db.scalar(
        select(WfExecutionReceiptRow).where(WfExecutionReceiptRow.action_id == action.id)
    )
    latest_exec = db.scalar(
        select(WfActionExecutionRow)
        .where(WfActionExecutionRow.action_id == action.id)
        .order_by(WfActionExecutionRow.started_at.desc())
    )
    lifecycle, status_detail = _lifecycle_status(action, latest_exec)
    expires = _aware(action.expires_at)
    return {
        "id": action.id,
        "reference": action.reference,
        "action_type": action.action_type,
        "title": action.title,
        "purpose": action.purpose,
        "status": action.status,
        "lifecycle_status": lifecycle,
        "status_detail": status_detail,
        "destination": action.destination,
        "environment": action.environment,
        "environment_label": {
            "SANDBOX": "Sandbox (test, no real claim)",
            "INTERNAL": "Inside INSURRA only",
            "MANUAL_HANDOFF": "Draft only. INSURRA does not send it",
        }.get(action.environment, action.environment),
        "payload": action.payload,
        "payload_sha256": action.payload_sha256,
        "payload_version": action.payload_version,
        "required_permissions": action.required_permissions,
        "expires_at": action.expires_at,
        "is_expired": bool(expires and expires <= _now() and action.status in PENDING),
        "claim_id": action.claim_id,
        "claim_reference": case.reference if case else None,
        "claim_title": case.title if case else None,
        "editable_fields": ACTION_TYPES[action.action_type]["editable"],
        "requires_approval": ACTION_TYPES[action.action_type]["approval"],
        "approved": approval is not None,
        "ai_prepared": action.ai_prepared,
        "consequence": _consequence(action),
        "privacy_note": _privacy(action),
        "receipt_reference": receipt.receipt_ref if receipt else None,
        "created_at": action.created_at,
        "updated_at": action.updated_at,
    }


def _consequence(action: WfActionRow) -> str:
    if action.action_type == "sandbox_claim_submit":
        return (
            "Approving lets INSURRA send exactly this payload to the insurer sandbox. "
            "The sandbox is a test environment. No real claim is submitted."
        )
    if action.environment == "MANUAL_HANDOFF":
        return (
            "Approving marks this draft as ready. INSURRA has no insurer integration, so "
            "nothing is sent. Copy it or open it in your own email app."
        )
    return "This action runs inside INSURRA and does not contact any outside party."


def _privacy(action: WfActionRow) -> str:
    if action.action_type == "sandbox_claim_submit":
        return (
            "Shared with the sandbox: claim details, your name, the provider, the amount and "
            "references to the attached documents. Documents themselves are not copied."
        )
    if action.environment == "MANUAL_HANDOFF":
        return "The draft contains only the fields shown. No document is attached automatically."
    return "No data leaves INSURRA."


def latest_valid_approval(db: Session, action: WfActionRow) -> WfActionApprovalRow | None:
    return db.scalar(
        select(WfActionApprovalRow)
        .where(
            WfActionApprovalRow.action_id == action.id,
            WfActionApprovalRow.decision == "APPROVED",
            WfActionApprovalRow.invalidated_at.is_(None),
            WfActionApprovalRow.payload_version == action.payload_version,
        )
        .order_by(WfActionApprovalRow.created_at.desc())
    )


def _security(
    db: Session, owner: Owner, event_type: str, title: str, action: WfActionRow, code: str
):
    audit.record(
        db,
        owner,
        event_type,
        "SECURITY",
        title,
        summary="The request was blocked by the server-side approval boundary.",
        actor_type="BACKEND_EXECUTED",
        tool="verify_action_approval",
        result_status="BLOCKED",
        reason=code,
        action_id=action.id,
        claim_id=action.claim_id,
        details={
            "action_type": action.action_type,
            "action_reference": action.reference,
            "reason_code": code,
        },
    )


def approve(
    db: Session, owner: Owner, action: WfActionRow, payload_sha: str, payload_version: int
) -> WfActionRow:
    if action.status not in ("AWAITING_APPROVAL", "DRAFT"):
        raise AppError(
            409,
            "ACTION_NOT_PENDING",
            "This action is not waiting for approval.",
            {"status": action.status},
        )
    expires = _aware(action.expires_at)
    if expires and expires <= _now():
        action.status = "EXPIRED"
        db.commit()
        raise AppError(409, "ACTION_EXPIRED", "This approval request expired. Prepare it again.")
    if payload_version != action.payload_version:
        _security(
            db,
            owner,
            "INVALID_APPROVAL_HASH",
            "Approval rejected: payload version stale",
            action,
            "PAYLOAD_VERSION_STALE",
        )
        db.commit()
        raise AppError(
            409,
            "PAYLOAD_VERSION_STALE",
            "The action version is stale. Review the latest version.",
            {"current_version": action.payload_version},
        )
    if (
        payload_sha != action.payload_sha256
        or payload_sha256(action.payload) != action.payload_sha256
    ):
        _security(
            db,
            owner,
            "INVALID_APPROVAL_HASH",
            "Approval rejected: payload changed",
            action,
            "PAYLOAD_HASH_MISMATCH",
        )
        db.commit()
        raise AppError(
            409,
            "APPROVAL_HASH_MISMATCH",
            "The action changed since you reviewed it. Review it again.",
        )
    for permission in action.required_permissions:
        require_purpose(db, owner, permission)
    approval = WfActionApprovalRow(
        action_id=action.id,
        owner_kind=owner.kind,
        owner_id=owner.id,
        decision="APPROVED",
        action_type=action.action_type,
        payload_sha256=action.payload_sha256,
        payload_version=action.payload_version,
        destination=action.destination,
        permissions=action.required_permissions,
        expires_at=action.expires_at,
        created_at=_now(),
    )
    db.add(approval)
    action.status = "APPROVED"
    action.updated_at = _now()
    audit.record(
        db,
        owner,
        "ACTION_APPROVED",
        "ACTIONS",
        "Action approved",
        summary=f"You approved '{action.title}' for the exact payload you reviewed.",
        actor_type="USER",
        tool="request_action_approval",
        action_id=action.id,
        claim_id=action.claim_id,
        details={
            "action_type": action.action_type,
            "action_reference": action.reference,
            "environment": action.environment,
            "payload_digest": action.payload_sha256[:16],
        },
    )
    dispatch(db, owner, "action.approved", action.id, {"dedupe_part": action.payload_sha256[:16]})
    db.flush()
    return action


def _release_claim(db: Session, owner: Owner, action: WfActionRow, source: str):
    if action.claim_id and action.action_type == "sandbox_claim_submit":
        case = db.get(WfClaimCaseRow, action.claim_id)
        if case is not None and case.status == states.AWAITING_APPROVAL:
            states.transition(
                db, case, states.READY_FOR_APPROVAL, source=source, note="Approval request ended"
            )


def reject(db: Session, owner: Owner, action: WfActionRow) -> WfActionRow:
    if action.status not in ("AWAITING_APPROVAL", "APPROVED", "DRAFT"):
        raise AppError(409, "ACTION_NOT_PENDING", "This action can no longer be rejected.")
    action.status = "REJECTED"
    action.updated_at = _now()
    for approval in db.scalars(
        select(WfActionApprovalRow).where(WfActionApprovalRow.action_id == action.id)
    ):
        if approval.invalidated_at is None:
            approval.invalidated_at, approval.invalidation_reason = _now(), "REJECTED"
    db.add(
        WfActionApprovalRow(
            action_id=action.id,
            owner_kind=owner.kind,
            owner_id=owner.id,
            decision="REJECTED",
            action_type=action.action_type,
            payload_sha256=action.payload_sha256,
            payload_version=action.payload_version,
            destination=action.destination,
            permissions=[],
            created_at=_now(),
            invalidated_at=_now(),
            invalidation_reason="REJECTED",
        )
    )
    _release_claim(db, owner, action, "USER")
    audit.record(
        db,
        owner,
        "ACTION_REJECTED",
        "ACTIONS",
        "Action rejected",
        summary=f"You rejected '{action.title}'. Nothing was executed.",
        actor_type="USER",
        action_id=action.id,
        claim_id=action.claim_id,
        details={"action_type": action.action_type, "action_reference": action.reference},
    )
    return action


def cancel(db: Session, owner: Owner, action: WfActionRow) -> WfActionRow:
    if action.status not in ("AWAITING_APPROVAL", "APPROVED", "DRAFT"):
        raise AppError(409, "ACTION_NOT_PENDING", "This action can no longer be cancelled.")
    invalidate_action(db, owner, action, "CANCELLED_BY_USER", actor="USER")
    return action


def invalidate_action(
    db: Session, owner: Owner, action: WfActionRow, reason: str, actor: str = "SYSTEM"
) -> None:
    for approval in db.scalars(
        select(WfActionApprovalRow).where(WfActionApprovalRow.action_id == action.id)
    ):
        if approval.invalidated_at is None:
            approval.invalidated_at, approval.invalidation_reason = _now(), reason[:60]
    action.status = "CANCELLED"
    action.updated_at = _now()
    if reason == "CANCELLED_BY_USER":
        _release_claim(db, owner, action, "USER")
    audit.record(
        db,
        owner,
        "APPROVAL_INVALIDATED" if actor == "SYSTEM" else "ACTION_CANCELLED",
        "ACTIONS",
        "Approval invalidated" if actor == "SYSTEM" else "Action cancelled",
        summary="The pending action ended because the underlying claim changed."
        if actor == "SYSTEM"
        else f"You cancelled '{action.title}'. Nothing was executed.",
        actor_type=actor,
        action_id=action.id,
        claim_id=action.claim_id,
        reason=reason,
        details={
            "action_type": action.action_type,
            "action_reference": action.reference,
            "reason_code": reason,
        },
    )


def edit_action(
    db: Session, owner: Owner, action: WfActionRow, changes: dict[str, str]
) -> WfActionRow:
    meta = ACTION_TYPES[action.action_type]
    if action.status not in ("AWAITING_APPROVAL", "APPROVED", "DRAFT"):
        raise AppError(409, "ACTION_NOT_PENDING", "This action can no longer be edited.")
    if not meta["editable"]:
        raise AppError(
            409,
            "ACTION_NOT_EDITABLE",
            "Edit the claim draft instead. The action updates after you review it again.",
        )
    payload = dict(action.payload)
    for key, value in changes.items():
        if key not in meta["editable"]:
            raise AppError(422, "INVALID_FIELD", "That field cannot be edited.")
        payload[key] = (value or "").strip()[:4000]
    previous = action.payload_sha256
    action.payload = payload
    action.payload_sha256 = payload_sha256(payload)
    action.payload_version += 1
    action.status = "AWAITING_APPROVAL"
    action.expires_at = _now() + APPROVAL_TTL
    action.updated_at = _now()
    revoked = 0
    for approval in db.scalars(
        select(WfActionApprovalRow).where(WfActionApprovalRow.action_id == action.id)
    ):
        if approval.invalidated_at is None:
            approval.invalidated_at, approval.invalidation_reason = _now(), "PAYLOAD_EDITED"
            revoked += 1
    audit.record(
        db,
        owner,
        "ACTION_EDITED",
        "ACTIONS",
        "Action edited, review again",
        summary="You edited the action. Any earlier approval is no longer valid.",
        actor_type="USER",
        action_id=action.id,
        claim_id=action.claim_id,
        details={
            "action_type": action.action_type,
            "action_reference": action.reference,
            "changed_fields": list(changes),
            "status": "APPROVAL_INVALIDATED" if revoked else "EDITED",
            "payload_digest": action.payload_sha256[:16],
        },
    )
    del previous
    return action


def _signature(receipt: WfExecutionReceiptRow) -> str:
    secret = get_settings().session_secret.get_secret_value() or "insurra-local-receipt-key"
    message = "|".join(
        [
            receipt.receipt_ref,
            str(receipt.action_id),
            receipt.claim_ref or "",
            receipt.payload_digest,
            receipt.environment,
            receipt.status,
            receipt.issued_at.replace(tzinfo=None).isoformat(),
        ]
    )
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def receipt_view(db: Session, receipt: WfExecutionReceiptRow) -> dict:
    action = db.get(WfActionRow, receipt.action_id)
    manual_notice = (
        "Calendar file generated. Draft prepared. Not sent. Nothing was sent by INSURRA."
        if action and action.action_type == "calendar_reminder_file"
        else "Draft prepared. Not sent. Approved draft. Nothing was sent by INSURRA."
    )
    return {
        "receipt_reference": receipt.receipt_ref,
        "action_id": receipt.action_id,
        "action_reference": action.reference if action else None,
        "action_title": action.title if action else None,
        "claim_reference": receipt.claim_ref,
        "environment": receipt.environment,
        "status": receipt.status,
        "payload_digest": receipt.payload_digest,
        "submitted_at": receipt.issued_at,
        "audit_event_id": receipt.audit_event_id,
        "next_action": receipt.next_action,
        "signature": receipt.signature,
        "signature_valid": hmac.compare_digest(receipt.signature, _signature(receipt)),
        "notice": {
            "SANDBOX": (
                "Accepted by the INSURRA test sandbox. No insurer received this. "
                "Sandbox receipt. No real claim was sent to an insurer."
            ),
            "MANUAL_HANDOFF": manual_notice,
            "INTERNAL": "Reminder scheduled in INSURRA. Internal INSURRA action.",
        }.get(receipt.environment, ""),
    }


def _issue_receipt(
    db: Session,
    owner: Owner,
    action: WfActionRow,
    execution: WfActionExecutionRow,
    status: str,
    claim_ref: str | None,
    audit_id: UUID | None,
    next_action: str,
) -> WfExecutionReceiptRow:
    receipt = WfExecutionReceiptRow(
        receipt_ref=f"RCT-{_now().year}-{secrets.token_hex(4).upper()}",
        action_id=action.id,
        execution_id=execution.id,
        owner_kind=owner.kind,
        owner_id=owner.id,
        environment=action.environment,
        status=status,
        claim_ref=claim_ref,
        payload_digest=action.payload_sha256,
        audit_event_id=audit_id,
        next_action=next_action,
        signature="",
        issued_at=_now(),
    )
    receipt.signature = _signature(receipt)
    db.add(receipt)
    db.flush()
    return receipt


def execute(db: Session, owner: Owner, action: WfActionRow) -> tuple[dict, bool]:
    """Run an approved action. Returns (receipt view, replayed)."""
    meta = ACTION_TYPES[action.action_type]
    if action.status in COMPLETED:
        receipt = db.scalar(
            select(WfExecutionReceiptRow).where(WfExecutionReceiptRow.action_id == action.id)
        )
        if receipt is not None:
            return receipt_view(db, receipt), True
    if meta["approval"]:
        approval = latest_valid_approval(db, action)
        if action.status != "APPROVED" or approval is None:
            _security(
                db,
                owner,
                "UNAPPROVED_EXECUTION_BLOCKED",
                "Unapproved execution blocked",
                action,
                "ACTION_NOT_APPROVED",
            )
            db.commit()
            raise AppError(403, "ACTION_NOT_APPROVED", "This action has not been approved.")
        if (
            approval.payload_sha256 != action.payload_sha256
            or payload_sha256(action.payload) != approval.payload_sha256
            or approval.payload_version != action.payload_version
            or approval.action_type != action.action_type
        ):
            _security(
                db,
                owner,
                "INVALID_APPROVAL_HASH",
                "Execution blocked: payload changed",
                action,
                "PAYLOAD_HASH_MISMATCH",
            )
            db.commit()
            raise AppError(
                403, "APPROVAL_HASH_MISMATCH", "The payload differs from what was approved."
            )
        if (
            approval.destination != action.destination
            or action.destination not in ALLOWED_DESTINATIONS[action.action_type]
        ):
            _security(
                db,
                owner,
                "DISALLOWED_DESTINATION",
                "Execution blocked: destination",
                action,
                "DESTINATION_NOT_ALLOWED",
            )
            db.commit()
            raise AppError(
                403, "DESTINATION_NOT_ALLOWED", "The destination is not allowed for this action."
            )
        expires = _aware(approval.expires_at)
        if expires and expires <= _now():
            action.status = "EXPIRED"
            db.commit()
            raise AppError(409, "ACTION_EXPIRED", "The approval expired. Prepare the action again.")
        try:
            for permission in action.required_permissions:
                require_purpose(db, owner, permission)
        except AppError:
            _security(
                db,
                owner,
                "CONSENT_REVOKED_BLOCK",
                "Execution blocked: consent revoked",
                action,
                "CONSENT_REQUIRED",
            )
            db.commit()
            raise
    else:
        approval = None
    if action.status in ("FAILED", "REJECTED", "CANCELLED", "EXPIRED"):
        raise AppError(
            409,
            "ACTION_NOT_EXECUTABLE",
            "This action can no longer be executed.",
            {"status": action.status},
        )
    since = _now() - timedelta(minutes=1)
    recent = (
        db.scalar(
            select(func.count())
            .select_from(WfActionExecutionRow)
            .join(WfActionRow, WfActionRow.id == WfActionExecutionRow.action_id)
            .where(
                WfActionRow.owner_kind == owner.kind,
                WfActionRow.owner_id == owner.id,
                WfActionExecutionRow.started_at >= since,
            )
        )
        or 0
    )
    if recent >= RATE_LIMIT_PER_MINUTE:
        raise AppError(429, "RATE_LIMITED", "Too many executions. Try again in a minute.")
    key = f"exec:{action.id}:{approval.id if approval else 'internal'}"
    execution = db.scalar(
        select(WfActionExecutionRow).where(WfActionExecutionRow.idempotency_key == key)
    )
    if execution is not None and execution.status == "SUCCEEDED":
        receipt = db.scalar(
            select(WfExecutionReceiptRow).where(WfExecutionReceiptRow.action_id == action.id)
        )
        return receipt_view(db, receipt), True
    execution = WfActionExecutionRow(
        action_id=action.id,
        approval_id=approval.id if approval else _internal_approval(db, owner, action).id,
        idempotency_key=key,
        environment=action.environment,
        status="RUNNING",
        started_at=_now(),
    )
    db.add(execution)
    db.flush()
    claim_ref, next_action, status = None, "No further action needed.", "EXECUTED"
    handoff_meta: dict = {}
    try:
        if action.action_type == "sandbox_claim_submit":
            claim_ref, next_action = _execute_sandbox(db, owner, action)
        elif action.environment == "MANUAL_HANDOFF":
            status, next_action, handoff_meta = executors.execute_manual_handoff(action)
        elif action.action_type == "internal_reminder":
            _execute_reminder(db, owner, action)
            next_action = "Reminder scheduled in INSURRA."
    except sandbox.SandboxError as exc:
        execution.status, execution.error_code = "FAILED", "SANDBOX_VALIDATION_FAILED"
        execution.finished_at = _now()
        action.status = "FAILED"
        audit.record(
            db,
            owner,
            "SANDBOX_SUBMISSION_FAILED",
            "ACTIONS",
            "Sandbox rejected the submission",
            summary="The sandbox returned validation errors. No claim was created.",
            actor_type="SANDBOX",
            tool="execute_sandbox_claim",
            result_status="FAILED",
            action_id=action.id,
            claim_id=action.claim_id,
            details={
                "action_type": action.action_type,
                "action_reference": action.reference,
                "error_code": "SANDBOX_VALIDATION_FAILED",
                "missing_items": [f"{e['field']}:{e['code']}" for e in exc.errors],
            },
        )
        db.commit()
        raise AppError(
            422,
            "SANDBOX_VALIDATION_FAILED",
            "The sandbox rejected the claim payload.",
            {"errors": exc.errors},
        ) from exc
    execution.status, execution.finished_at = "SUCCEEDED", _now()
    execution.result = {"claim_reference": claim_ref, "status": status, **handoff_meta}
    action.status = "HANDOFF_READY" if action.environment == "MANUAL_HANDOFF" else "COMPLETED"
    action.updated_at = _now()
    event = audit.record(
        db,
        owner,
        {"SANDBOX": "SANDBOX_SUBMISSION", "MANUAL_HANDOFF": "DRAFT_HANDOFF_READY"}.get(
            action.environment, "ACTION_EXECUTED"
        ),
        "ACTIONS",
        {
            "SANDBOX": "Action submitted to sandbox",
            "MANUAL_HANDOFF": "Draft approved, not sent",
        }.get(action.environment, "Action completed"),
        summary={
            "SANDBOX": f"INSURRA submitted {claim_ref or 'the claim'} to the insurer sandbox. No real claim was sent.",
            "MANUAL_HANDOFF": "The approved draft is ready for you to send yourself. INSURRA sent nothing.",
        }.get(action.environment, f"'{action.title}' completed inside INSURRA."),
        actor_type="SANDBOX" if action.environment == "SANDBOX" else "BACKEND_EXECUTED",
        tool="execute_sandbox_claim" if action.environment == "SANDBOX" else "execute_action",
        action_id=action.id,
        claim_id=action.claim_id,
        receipt_ref=None,
        details={
            "action_type": action.action_type,
            "action_reference": action.reference,
            "environment": action.environment,
            "destination": action.destination,
            "sandbox_reference": claim_ref or "",
            "payload_digest": action.payload_sha256[:16],
        },
    )
    receipt = _issue_receipt(db, owner, action, execution, status, claim_ref, event.id, next_action)
    event.receipt_ref = receipt.receipt_ref
    dispatch(db, owner, "action.executed", action.id, {"dedupe_part": action.payload_sha256[:16]})
    db.flush()
    return receipt_view(db, receipt), False


def _internal_approval(db: Session, owner: Owner, action: WfActionRow) -> WfActionApprovalRow:
    row = WfActionApprovalRow(
        action_id=action.id,
        owner_kind=owner.kind,
        owner_id=owner.id,
        decision="APPROVED",
        action_type=action.action_type,
        payload_sha256=action.payload_sha256,
        payload_version=action.payload_version,
        destination=action.destination,
        permissions=action.required_permissions,
        created_at=_now(),
        invalidation_reason="INTERNAL_NO_APPROVAL_REQUIRED",
    )
    db.add(row)
    db.flush()
    return row


def _execute_sandbox(db: Session, owner: Owner, action: WfActionRow) -> tuple[str, str]:
    case = db.get(WfClaimCaseRow, action.claim_id)
    row = sandbox.submit(db, owner, action.payload, f"action:{action.id}:{action.payload_sha256}")
    if row is None or not getattr(row, "claim_ref", None):
        raise sandbox.SandboxError(
            [{"field": "sandbox_ref", "code": "MISSING_PROOF_OF_SUBMISSION"}]
        )
    if case is not None:
        case.sandbox_ref, case.sandbox_status = row.claim_ref, row.status
        case.monitoring_state = "ACTIVE" if case.monitoring_enabled else "DISABLED"
        case.last_checked_at = _now()
        case.next_poll_at = _now() + timedelta(seconds=max(1, get_settings().sandbox_step_seconds))
        if case.status == states.AWAITING_APPROVAL:
            states.transition(
                db,
                case,
                states.SUBMITTED,
                source="SYSTEM",
                event_type="SANDBOX_SUBMITTED",
                note=f"Sandbox reference {row.claim_ref}",
                dedupe_key=f"submit:{row.claim_ref}:{row.payload_digest[:8]}",
            )
    return row.claim_ref, "Track the sandbox status in the Claims Center."


def _execute_reminder(db: Session, owner: Owner, action: WfActionRow) -> None:
    payload = action.payload
    key = f"manual:{action.id}"
    if (
        db.scalar(
            select(WfReminderRow).where(
                WfReminderRow.owner_kind == owner.kind,
                WfReminderRow.owner_id == owner.id,
                WfReminderRow.dedupe_key == key,
            )
        )
        is None
    ):
        db.add(
            WfReminderRow(
                owner_kind=owner.kind,
                owner_id=owner.id,
                kind="INTERNAL",
                title=payload.get("title", "Reminder")[:200],
                detail=(payload.get("detail") or "")[:500],
                claim_id=action.claim_id,
                due_date=payload.get("due_date", _now().date().isoformat()),
                dedupe_key=key,
            )
        )


def complete_internal(db: Session, owner: Owner, action: WfActionRow) -> dict:
    receipt, _ = execute(db, owner, action)
    return receipt
