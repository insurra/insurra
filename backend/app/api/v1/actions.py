from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dependencies import DB, ActiveActor, ConsentedSession
from app.core.errors import AppError, not_implemented
from app.models import ActionRow
from app.repositories.ownership import owned_resource
from app.schemas.action import (
    ActionDecisionResult,
    ActionPermissionLevel,
    ActionStatus,
    ProposedAction,
)
from app.schemas.foundation import ActionDecisionRequest
from app.services.approval import payload_sha256
from app.services.audit_logger import log_event

router = APIRouter(prefix="/actions", tags=["Actions"])


DEMO_ACTION_TEMPLATES: tuple[tuple[str, dict], ...] = (
    (
        "claim_submit",
        {
            "permission_level": "L2",
            "summary_action": "Klaim akan dikirim ke penyedia (sandbox)",
            "preview": "Klaim akan dikirim ke penyedia (sandbox) — Rawat Jalan GP Allianz OSHC",
            "source_screen": "SC-09 · Kesiapan Klaim",
            "message": (
                "Mohon proses klaim reimbursement kunjungan GP tanggal 12 Oktober 2026 "
                "sesuai kuitansi terlampir."
            ),
            "reminder_date": "2026-10-25",
            "bank_account_holder": "",
            "additional_notes": "",
            "provider": "Allianz Care Australia (OSHC)",
            "policy_number": "****1234",
            "diagnosis_code": "J06.9 - Acute upper respiratory infection",
            "claim_amount": "125.00 AUD",
            "document_sourced_fields": [
                "provider",
                "policy_number",
                "diagnosis_code",
                "claim_amount",
            ],
        },
    ),
    (
        "draft_message",
        {
            "permission_level": "L1",
            "summary_action": "Draf pesan konfirmasi manfaat akan disiapkan untuk penyedia",
            "preview": "Draf pesan konfirmasi manfaat rawat jalan ke layanan pelanggan asuransi",
            "source_screen": "SC-06 · Tanya Polis",
            "message": (
                "Halo tim layanan polis, saya ingin mengonfirmasi cakupan direct billing "
                "klinik GP pada polis ****1234."
            ),
            "reminder_date": "2026-10-22",
            "recipient_department": "",
            "provider": "Allianz Care Australia (OSHC)",
            "policy_number": "****1234",
            "document_sourced_fields": ["provider", "policy_number"],
        },
    ),
    (
        "create_reminder",
        {
            "permission_level": "L1",
            "summary_action": "Pengingat perpanjangan polis akan ditambahkan ke jadwal",
            "preview": "Pengingat perpanjangan masa berlaku polis OSHC sebelum visa berakhir",
            "source_screen": "SC-04 · Kelengkapan Data",
            "message": (
                "Perpanjang polis OSHC minimal 30 hari sebelum tanggal kedaluwarsa untuk "
                "mencegah jeda perlindungan visa."
            ),
            "reminder_date": "2027-03-15",
            "notification_channel": "",
            "policy_end_date": "2027-04-15",
            "visa_expiry_date": "2027-06-30",
            "document_sourced_fields": ["policy_end_date", "visa_expiry_date"],
        },
    ),
)


def _resolve_permission_level(row: ActionRow) -> ActionPermissionLevel:
    payload = row.payload if isinstance(row.payload, dict) else {}
    raw_level = payload.get("permission_level")
    if isinstance(raw_level, str) and raw_level in {"L0", "L1", "L2", "L3"}:
        return ActionPermissionLevel(raw_level)
    if row.type in {"claim_submit", "claim_form", "sandbox_claim", "draft_claim_form"}:
        return ActionPermissionLevel.L2
    return ActionPermissionLevel.L1


def serialize_action(row: ActionRow) -> ProposedAction:
    payload = dict(row.payload) if isinstance(row.payload, dict) else {}
    reason = (
        str(
            payload.get("rejection_reason")
            or payload.get("decision_reason")
            or payload.get("reason")
            or ""
        ).strip()
        or None
    )
    preview = str(
        payload.get("preview")
        or payload.get("summary_action")
        or payload.get("message")
        or f"Tindakan {row.type}"
    )[:240]
    source_screen = str(
        payload.get("source_screen")
        or ("SC-09 · Kesiapan Klaim" if "claim" in row.type else "SC-10 · Persetujuan Tindakan")
    )
    created_raw = payload.get("created_at")
    created_at = row.approved_at or datetime.now(UTC)
    if isinstance(created_raw, str):
        try:
            created_at = datetime.fromisoformat(created_raw)
        except ValueError:
            pass
    return ProposedAction(
        id=row.id,
        action_type=row.type,
        status=ActionStatus(row.status),
        preview=preview,
        created_at=created_at,
        approved_at=row.approved_at,
        payload=payload,
        reason=reason,
        permission_level=_resolve_permission_level(row),
        source_screen=source_screen,
        approved_payload_sha256=row.approved_payload_sha256,
    )


def ensure_demo_actions(db: Session, session_id: UUID) -> None:
    existing = db.scalar(select(ActionRow.id).where(ActionRow.session_id == session_id).limit(1))
    if existing is not None:
        return
    now = datetime.now(UTC)
    for action_type, template in DEMO_ACTION_TEMPLATES:
        payload = {**template, "created_at": now.isoformat()}
        db.add(
            ActionRow(
                id=uuid4(),
                session_id=session_id,
                claim_case_id=None,
                type=action_type,
                payload=payload,
                status=ActionStatus.PENDING.value,
                approved_at=None,
                approved_payload_sha256=None,
            )
        )
    db.commit()


@router.get("", response_model=list[ProposedAction])
def actions(
    session: ConsentedSession,
    db: DB,
    seed_demo: Annotated[bool, Query()] = False,
):
    if seed_demo:
        ensure_demo_actions(db, session.id)
    rows = list(
        db.scalars(
            select(ActionRow).where(ActionRow.session_id == session.id).order_by(ActionRow.id.asc())
        )
    )
    if not rows:
        not_implemented()
    return [serialize_action(row) for row in rows]


@router.get("/{action_id}", response_model=ProposedAction)
def action_detail(
    action_id: UUID,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
):
    row = owned_resource(db, actor, "action", action_id)
    return serialize_action(row)


@router.post("/{action_id}/approve", response_model=ActionDecisionResult)
def approve(
    action_id: UUID,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    body: ActionDecisionRequest | None = None,
):
    row = owned_resource(db, actor, "action", action_id)
    if body is None:
        not_implemented()
    if row.status != ActionStatus.PENDING.value:
        raise AppError(
            409,
            "ACTION_ALREADY_DECIDED",
            "Payload tidak bisa diubah setelah disetujui; perubahan harus lewat draf baru.",
        )
    perm_level = _resolve_permission_level(row)
    if perm_level == ActionPermissionLevel.L2 and not body.confirmed:
        raise AppError(
            422,
            "L2_CONFIRMATION_REQUIRED",
            "Tindakan tingkat L2 wajib mencentang konfirmasi 'Saya sudah memeriksa isinya'.",
        )

    original_payload = dict(row.payload) if isinstance(row.payload, dict) else {}
    was_edited = body.edited_payload is not None
    doc_fields_changed: list[str] = []

    if body.edited_payload is not None:
        doc_sourced = set(
            original_payload.get("document_sourced_fields", [])
            if isinstance(original_payload.get("document_sourced_fields"), list)
            else []
        )
        for k in doc_sourced:
            if k in body.edited_payload and body.edited_payload.get(k) != original_payload.get(k):
                doc_fields_changed.append(str(k))
        row.payload = dict(body.edited_payload)

    now = datetime.now(UTC)
    row.status = ActionStatus.APPROVED.value
    row.approved_at = now
    row.approved_payload_sha256 = payload_sha256(row.payload)

    decision_reason = body.reason or (
        "Pengguna mengubah isi draf tindakan lalu menyetujui untuk dieksekusi."
        if was_edited
        else "Pengguna menyetujui draf tindakan apa adanya setelah memeriksa isi."
    )
    input_summary = (
        f"Pengguna mengubah isi draf ({row.type})"
        + (
            f" termasuk field sumber dokumen ({', '.join(doc_fields_changed)})"
            if doc_fields_changed
            else ""
        )
        + " lalu menyetujui tindakan."
        if was_edited
        else f"Pengguna menyetujui draf tindakan ({row.type}) tingkat {perm_level.value}."
    )
    result_summary = (
        f"Status tindakan menjadi APPROVED dengan hash payload "
        f"{row.approved_payload_sha256[:12]}..."
    )

    log_event(
        db,
        session.id,
        "ACTION_EDITED_AND_APPROVED" if was_edited else "ACTION_APPROVED",
        category="action",
        source_screen="SC-10 · Persetujuan Tindakan",
        input_summary=input_summary,
        tools_called=["draft_claim_form", "policy_guard"],
        result_summary=result_summary,
        reason=decision_reason,
        approval_status=ActionStatus.APPROVED.value,
        approval_time=now.isoformat(),
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
    row = owned_resource(db, actor, "action", action_id)
    if body is None:
        not_implemented()
    if row.status != ActionStatus.PENDING.value:
        raise AppError(
            409,
            "ACTION_ALREADY_DECIDED",
            "Tindakan yang sudah diputuskan tidak dapat diubah kembali.",
        )

    reject_reason = (body.reason or "Tidak perlu").strip()
    updated_payload = dict(row.payload) if isinstance(row.payload, dict) else {}
    updated_payload["rejection_reason"] = reject_reason
    row.payload = updated_payload
    row.status = ActionStatus.REJECTED.value

    log_event(
        db,
        session.id,
        "ACTION_REJECTED",
        category="action",
        source_screen="SC-10 · Persetujuan Tindakan",
        input_summary=f"Pengguna menolak tindakan ({row.type}) dengan alasan: {reject_reason}.",
        tools_called=["policy_guard"],
        result_summary=f"Status tindakan diubah menjadi REJECTED (Alasan: {reject_reason}).",
        reason=reject_reason,
        approval_status=ActionStatus.REJECTED.value,
    )
    db.commit()
    return ActionDecisionResult(status=ActionStatus.REJECTED)
