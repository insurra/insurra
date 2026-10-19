import re
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
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
    ActionProposeRequest,
    ActionStatus,
    ProposedAction,
)
from app.schemas.foundation import ActionDecisionRequest
from app.services.approval import payload_sha256
from app.services.audit_logger import log_event

router = APIRouter(prefix="/actions", tags=["Actions"])

ALLOWED_ACTION_TOOLS: dict[str, tuple[ActionPermissionLevel, str]] = {
    "create_reminder": (ActionPermissionLevel.L1, "Pengingat"),
    "draft_message": (ActionPermissionLevel.L1, "Draf pesan"),
    "draft_claim_form": (ActionPermissionLevel.L1, "Formulir klaim"),
    "submit_claim_sandbox": (
        ActionPermissionLevel.L2,
        "Kirim klaim ke penyedia (sandbox)",
    ),
    "claim_submit": (
        ActionPermissionLevel.L2,
        "Kirim klaim ke penyedia (sandbox)",
    ),
}

ALLOWED_SOURCE_PREFIXES = ("SC-04", "SC-06", "SC-07", "SC-08", "SC-09", "SC-10")

_POLICY_PREFIX_RE = re.compile(
    r"\b(?:OSHC|OVHC|POL|POLICY|BPJS|CARD|KARTU|MEM)[-\s]?[A-Z0-9]{2,12}(\d{4})\b",
    re.IGNORECASE,
)
_LONG_DIGITS_RE = re.compile(r"\b\d{4,12}(\d{4})\b")
_POLICY_FIELD_KEYS = {
    "policy_number",
    "card_number",
    "member_number",
    "nomor_polis",
    "nomor_kartu",
}


def _mask_policy_string(value: str, *, is_policy_field: bool = False) -> str:
    masked = _POLICY_PREFIX_RE.sub(r"****\1", value)
    masked = _LONG_DIGITS_RE.sub(r"****\1", masked)
    if is_policy_field:
        stripped = masked.strip()
        if stripped and not stripped.startswith("****"):
            digits = "".join(ch for ch in stripped if ch.isdigit())
            if len(digits) >= 4:
                return f"****{digits[-4:]}"
            if len(stripped) >= 4:
                return f"****{stripped[-4:]}"
    return masked


def _mask_payload(payload: dict[str, Any]) -> dict[str, Any]:
    masked_dict: dict[str, Any] = {}
    for key, val in payload.items():
        is_pol_key = key.lower() in _POLICY_FIELD_KEYS
        if isinstance(val, str):
            if key in {"created_at", "reminder_date", "policy_end_date", "visa_expiry_date"}:
                masked_dict[key] = val
            else:
                masked_dict[key] = _mask_policy_string(val, is_policy_field=is_pol_key)
        elif isinstance(val, dict):
            masked_dict[key] = _mask_payload(val)
        elif isinstance(val, list):
            masked_dict[key] = [
                _mask_policy_string(item, is_policy_field=is_pol_key)
                if isinstance(item, str)
                else item
                for item in val
            ]
        else:
            masked_dict[key] = val
    return masked_dict


DEMO_ACTION_TEMPLATES: tuple[tuple[str, dict[str, Any], int], ...] = (
    (
        "claim_submit",
        {
            "title": "Kirim klaim ke penyedia (sandbox) — Rawat Jalan GP",
            "reason": (
                "Dibuat karena seluruh bukti klaim rawat jalan GP pada checklist "
                "kesiapan klaim telah terverifikasi lengkap"
            ),
            "permission_level": "L2",
            "summary_action": "Klaim akan dikirim ke penyedia (sandbox)",
            "preview": (
                "Klaim akan dikirim ke penyedia (sandbox) — Rawat Jalan GP Allianz OSHC "
                "(Polis ****1234)"
            ),
            "source_screen": "SC-09 · Kesiapan Klaim",
            "message": (
                "Mohon proses klaim reimbursement kunjungan GP tanggal 12 Oktober 2026 "
                "untuk polis ****1234 sesuai kuitansi terlampir."
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
        0,
    ),
    (
        "draft_message",
        {
            "title": "Draf pesan konfirmasi manfaat rawat jalan ke penyedia",
            "reason": (
                "Dibuat karena jalur layanan klinik GP memerlukan konfirmasi "
                "cakupan direct billing sebelum kunjungan"
            ),
            "permission_level": "L1",
            "summary_action": "Draf pesan konfirmasi manfaat akan disiapkan untuk penyedia",
            "preview": (
                "Draf pesan konfirmasi manfaat rawat jalan ke layanan pelanggan "
                "asuransi untuk polis ****1234"
            ),
            "source_screen": "SC-07 · Bandingkan Jalur Layanan",
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
        2,
    ),
    (
        "create_reminder",
        {
            "title": "Pengingat perpanjangan masa berlaku polis OSHC",
            "reason": "Dibuat karena ada jeda 76 hari antara asuransi dan visa",
            "permission_level": "L1",
            "summary_action": "Pengingat perpanjangan polis akan ditambahkan ke jadwal",
            "preview": (
                "Pengingat perpanjangan masa berlaku polis OSHC ****1234 sebelum visa berakhir"
            ),
            "source_screen": "SC-04 · Cek Kelengkapan Data",
            "message": (
                "Perpanjang polis OSHC ****1234 minimal 30 hari sebelum tanggal kedaluwarsa "
                "untuk mencegah jeda perlindungan visa selama 76 hari."
            ),
            "reminder_date": "2027-03-15",
            "notification_channel": "",
            "policy_number": "****1234",
            "policy_end_date": "2027-04-15",
            "visa_expiry_date": "2027-06-30",
            "document_sourced_fields": [
                "policy_number",
                "policy_end_date",
                "visa_expiry_date",
            ],
        },
        16,
    ),
)


def _resolve_permission_level(row: ActionRow) -> ActionPermissionLevel:
    if row.type in ALLOWED_ACTION_TOOLS:
        canonical_level, _ = ALLOWED_ACTION_TOOLS[row.type]
        payload = row.payload if isinstance(row.payload, dict) else {}
        raw_level = payload.get("permission_level")
        if raw_level == "L2" or canonical_level == ActionPermissionLevel.L2:
            return ActionPermissionLevel.L2
        return canonical_level
    payload = row.payload if isinstance(row.payload, dict) else {}
    raw_level = payload.get("permission_level")
    if isinstance(raw_level, str) and raw_level in {"L0", "L1", "L2", "L3"}:
        return ActionPermissionLevel(raw_level)
    if row.type in {"claim_submit", "claim_form", "sandbox_claim", "submit_claim_sandbox"}:
        return ActionPermissionLevel.L2
    return ActionPermissionLevel.L1


def serialize_action(row: ActionRow) -> ProposedAction:
    raw_payload = dict(row.payload) if isinstance(row.payload, dict) else {}
    payload = _mask_payload(raw_payload)
    reason = (
        str(
            payload.get("rejection_reason")
            or payload.get("decision_reason")
            or payload.get("reason")
            or ""
        ).strip()
        or None
    )
    default_title = ALLOWED_ACTION_TOOLS.get(
        row.type, (ActionPermissionLevel.L1, f"Tindakan {row.type}")
    )[1]
    title = str(payload.get("title") or default_title).strip()
    preview_raw = str(
        payload.get("preview") or payload.get("summary_action") or payload.get("message") or title
    )[:240]
    preview = _mask_policy_string(preview_raw)
    source_screen = str(
        payload.get("source_screen")
        or ("SC-09 · Kesiapan Klaim" if "claim" in row.type else "SC-04 · Cek Kelengkapan Data")
    )
    created_raw = payload.get("created_at")
    now = datetime.now(UTC)
    created_at = row.approved_at or now
    if isinstance(created_raw, str):
        try:
            parsed_dt = datetime.fromisoformat(created_raw)
            created_at = parsed_dt if parsed_dt.tzinfo else parsed_dt.replace(tzinfo=UTC)
        except ValueError:
            pass
    is_stale = row.status == ActionStatus.PENDING.value and (now - created_at) > timedelta(days=14)
    stale_label = "Mungkin sudah tidak relevan" if is_stale else None
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
        title=title,
        is_stale=is_stale,
        stale_label=stale_label,
    )


def ensure_demo_actions(db: Session, session_id: UUID) -> None:
    existing = db.scalar(select(ActionRow.id).where(ActionRow.session_id == session_id).limit(1))
    if existing is not None:
        return
    now = datetime.now(UTC)
    for action_type, template, offset_days in DEMO_ACTION_TEMPLATES:
        created_time = now - timedelta(days=offset_days)
        payload = _mask_payload({**template, "created_at": created_time.isoformat()})
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
    include_empty: Annotated[bool, Query()] = False,
):
    if seed_demo:
        ensure_demo_actions(db, session.id)
    rows = list(
        db.scalars(
            select(ActionRow).where(ActionRow.session_id == session.id).order_by(ActionRow.id.asc())
        )
    )
    if not rows and not include_empty:
        not_implemented()
    return [serialize_action(row) for row in rows]


@router.post("", response_model=ProposedAction, status_code=201)
def propose_action(
    body: ActionProposeRequest,
    session: ConsentedSession,
    db: DB,
):
    raw_type = body.action_type.strip()
    req_level = (body.permission_level or "").strip().upper()

    if req_level == "L0":
        raise AppError(
            422,
            "ACTION_L0_NO_QUEUE",
            (
                "Tindakan tingkat L0 (Baca/jelaskan) tidak memerlukan persetujuan "
                "dan tidak masuk antrean."
            ),
        )

    source_screen = (body.source_screen or "SC-04 · Cek Kelengkapan Data").strip()
    is_valid_source = any(source_screen.startswith(prefix) for prefix in ALLOWED_SOURCE_PREFIXES)

    if req_level == "L3" or raw_type not in ALLOWED_ACTION_TOOLS or not is_valid_source:
        log_event(
            db,
            session.id,
            "GUARDRAIL_UNAPPROVED_ACTION",
            category="guardrail",
            subtype="Tindakan tanpa persetujuan diblokir",
            source_screen="SC-10 · Persetujuan Tindakan",
            input_summary=_mask_policy_string(
                f"Upaya membuat tindakan bertipe di luar daftar yang diizinkan "
                f"({raw_type}, tingkat {req_level or 'L3'})."
            ),
            tools_called=["policy_guard"],
            result_summary=(
                "Server menolak pembuatan tindakan karena tipe tool atau tingkat izin "
                "berada di luar daftar yang diizinkan."
            ),
            reason=(
                "Tindakan hanya boleh dibuat oleh tool resmi (create_reminder, draft_message, "
                "draft_claim_form, submit_claim_sandbox) dengan tingkat izin L1/L2."
            ),
            approval_status="BLOCKED",
        )
        db.commit()
        raise AppError(
            403,
            "ACTION_TYPE_FORBIDDEN",
            "Tindakan bertipe di luar daftar yang diizinkan atau tingkat L3 ditolak oleh server.",
        )

    enforced_level, default_title = ALLOWED_ACTION_TOOLS[raw_type]
    now = datetime.now(UTC)
    raw_payload = dict(body.payload) if isinstance(body.payload, dict) else {}
    raw_payload.update(
        {
            "title": (body.title or raw_payload.get("title") or default_title),
            "reason": (
                body.reason
                or raw_payload.get("reason")
                or "Dibuat oleh agen berdasarkan pemeriksaan dokumen dan aturan polis"
            ),
            "source_screen": source_screen,
            "permission_level": enforced_level.value,
            "created_at": str(raw_payload.get("created_at") or now.isoformat()),
        }
    )
    masked_payload = _mask_payload(raw_payload)
    row = ActionRow(
        id=uuid4(),
        session_id=session.id,
        claim_case_id=None,
        type=raw_type,
        payload=masked_payload,
        status=ActionStatus.PENDING.value,
        approved_at=None,
        approved_payload_sha256=None,
    )
    db.add(row)
    log_event(
        db,
        session.id,
        "ACTION_PROPOSED",
        category="action",
        source_screen=source_screen,
        input_summary=_mask_policy_string(
            f"Agen menyiapkan draf tindakan ({raw_type}) tingkat {enforced_level.value}."
        ),
        tools_called=[raw_type if raw_type != "claim_submit" else "submit_claim_sandbox"],
        result_summary=f"Draf tindakan masuk ke antrean Menunggu ({enforced_level.value}).",
        reason=str(masked_payload.get("reason") or ""),
        approval_status=ActionStatus.PENDING.value,
    )
    db.commit()
    return serialize_action(row)


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
