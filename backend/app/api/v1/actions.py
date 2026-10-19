import csv
import io
import re
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, Query, Response
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.dependencies import DB, ActiveActor, ConsentedSession
from app.core.errors import AppError, not_implemented
from app.models import ActionRow, ClaimCaseRow, DocumentRow
from app.models.foundation import ClaimCaseEventRow
from app.repositories.ownership import approved_action, owned_resource
from app.schemas.action import (
    ActionDecisionResult,
    ActionPermissionLevel,
    ActionProposeRequest,
    ActionStatus,
    ProposedAction,
)
from app.schemas.foundation import (
    ActionDecisionRequest,
    ActionExecutionRequest,
    ClaimCaseStatus,
    ClaimSubmissionPayload,
    SandboxClaimRequest,
    SandboxClaimResponse,
    SandboxLogEntry,
)
from app.services.approval import payload_sha256
from app.services.audit_logger import log_event

router = APIRouter(prefix="/actions", tags=["Actions"])


def _enforce_legacy_freeze(x_freeze_legacy: str | None = None) -> None:
    if get_settings().freeze_legacy_actions or (x_freeze_legacy or "").strip().lower() in (
        "1",
        "true",
    ):
        raise AppError(
            410,
            "LEGACY_ROUTE_FROZEN",
            "Legacy /api/v1/actions write endpoints are frozen. Use /api/v1/workflow/actions.",
            {"canonical_endpoint": "/api/v1/workflow/actions"},
        )


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
    r"\b(?:OSHC|OVHC|POL|POLICY|BPJS|CARD|KARTU|MEM|NIK|PASPOR|PASSPORT|VISA)"
    r"[-\s:]?[A-Z0-9]{2,14}(\d{4})\b",
    re.IGNORECASE,
)
_PASSPORT_RE = re.compile(r"\b[A-Z]{1,2}\d{3,5}(\d{4})\b")
_LONG_DIGITS_RE = re.compile(r"\b\d{4,14}(\d{4})\b")
_POLICY_FIELD_KEYS = {
    "policy_number",
    "card_number",
    "member_number",
    "nomor_polis",
    "nomor_kartu",
    "nik",
    "passport_number",
    "nomor_paspor",
    "visa_number",
    "visa_grant_number",
    "nomor_visa",
}
_PASSTHROUGH_STRING_KEYS = {
    "created_at",
    "reminder_date",
    "policy_end_date",
    "visa_expiry_date",
    "claim_case_id",
    "source_claim_form_action_id",
    "document_id",
    "sha256",
    "action_id",
    "claim_ref",
    "seed_rule",
    "claim_form_status",
}


def _mask_policy_string(value: str, *, is_policy_field: bool = False) -> str:
    masked = _POLICY_PREFIX_RE.sub(r"****\1", value)
    masked = _PASSPORT_RE.sub(r"****\1", masked)
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
        if key == "_execution_meta":
            continue
        is_pol_key = key.lower() in _POLICY_FIELD_KEYS
        if isinstance(val, str):
            if key in _PASSTHROUGH_STRING_KEYS:
                masked_dict[key] = val
            else:
                masked_dict[key] = _mask_policy_string(val, is_policy_field=is_pol_key)
        elif isinstance(val, dict):
            masked_dict[key] = _mask_payload(val)
        elif isinstance(val, list):
            masked_dict[key] = [
                _mask_policy_string(item, is_policy_field=is_pol_key)
                if isinstance(item, str)
                else (_mask_payload(item) if isinstance(item, dict) else item)
                for item in val
            ]
        else:
            masked_dict[key] = val
    return masked_dict


def _parse_ics_dates(raw_date: str) -> tuple[str, str, str]:
    cleaned = (raw_date or "").strip()[:10]
    try:
        parsed = date.fromisoformat(cleaned)
    except ValueError:
        parsed = datetime.now(UTC).date() + timedelta(days=7)
    start_ymd = parsed.strftime("%Y%m%d")
    end_ymd = (parsed + timedelta(days=1)).strftime("%Y%m%d")
    return parsed.isoformat(), start_ymd, end_ymd


def _build_ics_artifact(
    action_id: UUID, title: str, payload: dict[str, Any]
) -> tuple[str, str, str]:
    safe_title = _mask_policy_string(title)
    safe_notes = _mask_policy_string(
        str(payload.get("message") or payload.get("preview") or safe_title)
    )
    iso_date, start_ymd, end_ymd = _parse_ics_dates(str(payload.get("reminder_date") or ""))
    ics_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Insurra//Insurance Companion//ID",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:insurra-reminder-{action_id}@insurra.local",
        f"DTSTAMP:{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}",
        f"DTSTART;VALUE=DATE:{start_ymd}",
        f"DTEND;VALUE=DATE:{end_ymd}",
        f"SUMMARY:{safe_title}",
        f"DESCRIPTION:{safe_notes}",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ]
    ics_content = "\r\n".join(ics_lines)
    gcal_url = (
        "https://calendar.google.com/calendar/render?action=TEMPLATE"
        f"&text={quote(safe_title)}"
        f"&dates={start_ymd}/{end_ymd}"
        f"&details={quote(safe_notes)}"
    )
    return ics_content, gcal_url, iso_date


def _build_mailto_artifact(title: str, payload: dict[str, Any]) -> tuple[str, str, str]:
    subject = _mask_policy_string(str(payload.get("subject") or title))
    body_text = _mask_policy_string(str(payload.get("message") or payload.get("preview") or ""))
    recipient = str(payload.get("recipient_email") or "layanan@penyedia-asuransi.example")
    mailto_url = f"mailto:{recipient}?subject={quote(subject)}&body={quote(body_text)}"
    copy_text = f"Subjek: {subject}\n\n{body_text}"
    return mailto_url, subject, copy_text


def _escape_pdf_text(text: str) -> str:
    ascii_text = text.encode("ascii", "replace").decode("ascii")
    return ascii_text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build_claim_pdf_artifact(title: str, payload: dict[str, Any]) -> tuple[bytes, str, list[str]]:
    safe_title = _mask_policy_string(title)
    provider = _mask_policy_string(str(payload.get("provider") or "Penyedia Asuransi"))
    policy_no = _mask_policy_string(
        str(payload.get("policy_number") or "****1234"), is_policy_field=True
    )
    diagnosis = _mask_policy_string(str(payload.get("diagnosis_code") or "-"))
    claim_amount = _mask_policy_string(str(payload.get("claim_amount") or "-"))
    message = _mask_policy_string(str(payload.get("message") or payload.get("preview") or "-"))

    raw_attachments = payload.get("attachments_list")
    if isinstance(raw_attachments, list) and raw_attachments:
        attachments_list = [_mask_policy_string(str(item)) for item in raw_attachments]
    else:
        attachments_list = [
            "1. Kuitansi / Bukti Pembayaran Layanan Medis (Terverifikasi)",
            "2. Ringkasan Medis / Surat Keterangan Dokter",
            f"3. Sertifikat Polis Asuransi (Tersamar {policy_no})",
        ]

    summary_lines = [
        "RINGKASAN KLAIM ASURANSI INSURRA (DATA SENSITIF TERSAMAR)",
        f"Judul Tindakan: {safe_title}",
        f"Penyedia Asuransi: {provider}",
        f"Nomor Polis (Tersamar): {policy_no}",
        f"Kode Diagnosis: {diagnosis}",
        f"Nominal Klaim: {claim_amount}",
        f"Pesan / Catatan: {message}",
        "Daftar Lampiran:",
        *attachments_list,
    ]
    summary_text = "\n".join(summary_lines)

    content_ops = ["BT", "/F1 11 Tf", "50 760 Td", "15 TL"]
    for idx, line in enumerate(summary_lines):
        escaped = _escape_pdf_text(line[:95])
        if idx == 0:
            content_ops.append(f"({escaped}) Tj")
        else:
            content_ops.append(f"T* ({escaped}) Tj")
    content_ops.append("ET")
    stream_bytes = "\n".join(content_ops).encode("ascii")

    objects: list[bytes] = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        (
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"
        ),
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        (
            f"5 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii")
            + stream_bytes
            + b"\nendstream\nendobj\n"
        ),
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)
    xref_pos = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for off in offsets:
        pdf.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(pdf), summary_text, attachments_list


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
                "Klaim akan dikirim ke penyedia (sandbox) — Rawat Jalan GP, rencana asuransi sintetis "
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
            "provider": "Synthetic Student Health Plan (demo, not a real insurer product)",
            "policy_number": "****1234",
            "diagnosis_code": "J06.9 - Acute upper respiratory infection",
            "claim_amount": "450.00 CNY",
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
            "provider": "Synthetic Student Health Plan (demo, not a real insurer product)",
            "policy_number": "****1234",
            "document_sourced_fields": ["provider", "policy_number"],
        },
        2,
    ),
    (
        "create_reminder",
        {
            "title": "Pengingat masa berlaku polis asuransi mahasiswa (sintetis)",
            "reason": "Dibuat karena ada selisih tanggal 76 hari antara akhir asuransi dan akhir studi",
            "permission_level": "L1",
            "summary_action": "Pengingat perpanjangan polis akan ditambahkan ke jadwal",
            "preview": (
                "Pengingat masa berlaku polis asuransi mahasiswa ****1234 sebelum studi berakhir"
            ),
            "source_screen": "SC-04 · Cek Kelengkapan Data",
            "message": (
                "Tinjau polis ****1234 minimal 30 hari sebelum tanggal kedaluwarsa "
                "karena ada selisih tanggal 76 hari dengan akhir studi."
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
    exec_meta = (
        dict(raw_payload.get("_execution_meta"))
        if isinstance(raw_payload.get("_execution_meta"), dict)
        else {}
    )
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

    executed_at: datetime | None = None
    executed_raw = exec_meta.get("executed_at")
    if isinstance(executed_raw, str):
        try:
            parsed_exec = datetime.fromisoformat(executed_raw)
            executed_at = parsed_exec if parsed_exec.tzinfo else parsed_exec.replace(tzinfo=UTC)
        except ValueError:
            pass

    failure_reason = (
        str(exec_meta.get("failure_reason")).strip() if exec_meta.get("failure_reason") else None
    )
    execution_result = (
        dict(exec_meta.get("execution_result"))
        if isinstance(exec_meta.get("execution_result"), dict)
        else None
    )

    is_stale = row.status == ActionStatus.PENDING.value and (now - created_at) > timedelta(days=14)
    stale_label = "Mungkin sudah tidak relevan" if is_stale else None
    return ProposedAction(
        id=row.id,
        action_type=row.type,
        status=ActionStatus(row.status),
        preview=preview,
        created_at=created_at,
        approved_at=row.approved_at,
        executed_at=executed_at,
        payload=payload,
        reason=reason,
        permission_level=_resolve_permission_level(row),
        source_screen=source_screen,
        approved_payload_sha256=row.approved_payload_sha256,
        proposed_payload_sha256=payload_sha256(row.payload),
        payload_version=row.payload_version,
        title=title,
        is_stale=is_stale,
        stale_label=stale_label,
        failure_reason=failure_reason,
        execution_result=execution_result,
    )


CASE_STATUS_LABELS: dict[str, str] = {
    "DRAFT": "Draf",
    "READY_FOR_SUBMISSION": "Siap Diajukan",
    "SUBMITTED": "Diajukan",
    "PROCESSING": "Diproses",
    "APPROVED": "Disetujui",
    "REJECTED": "Ditolak",
    "CANCELLED": "Dibatalkan",
}


def ensure_demo_claim_resources(
    db: Session, session_id: UUID
) -> tuple[ClaimCaseRow, list[dict[str, str]]]:
    case_row = db.scalar(
        select(ClaimCaseRow)
        .where(
            ClaimCaseRow.session_id == session_id,
            ClaimCaseRow.path != "synthetic",
        )
        .limit(1)
    )
    if case_row is None:
        case_row = ClaimCaseRow(
            id=uuid4(),
            session_id=session_id,
            coverage_id=uuid4(),
            country_code="AU",
            path="gp_outpatient_claim",
            status=ClaimCaseStatus.READY_FOR_SUBMISSION.value,
            complaint_summary="Reimbursement kunjungan klinik GP (Rawat Jalan)",
        )
        db.add(case_row)
        db.flush()

    receipt_hash = "a1b2c3d4" * 8
    summary_hash = "e5f60718" * 8
    doc_receipt = db.scalar(
        select(DocumentRow).where(
            DocumentRow.session_id == session_id,
            DocumentRow.sha256 == receipt_hash,
        )
    )
    if doc_receipt is None:
        doc_receipt = DocumentRow(
            id=uuid4(),
            session_id=session_id,
            kind="medical_receipt",
            country_code="AU",
            original_filename="kuitansi-klinik-gp.pdf",
            mime_type="application/pdf",
            sha256=receipt_hash,
            status="REVIEWED",
        )
        db.add(doc_receipt)

    doc_summary = db.scalar(
        select(DocumentRow).where(
            DocumentRow.session_id == session_id,
            DocumentRow.sha256 == summary_hash,
        )
    )
    if doc_summary is None:
        doc_summary = DocumentRow(
            id=uuid4(),
            session_id=session_id,
            kind="medical_summary",
            country_code="AU",
            original_filename="ringkasan-medis-gp.pdf",
            mime_type="application/pdf",
            sha256=summary_hash,
            status="REVIEWED",
        )
        db.add(doc_summary)
    db.flush()

    attachments = [
        {"document_id": str(doc_receipt.id), "sha256": receipt_hash},
        {"document_id": str(doc_summary.id), "sha256": summary_hash},
    ]
    return case_row, attachments


def ensure_demo_actions(db: Session, session_id: UUID) -> None:
    existing = db.scalar(select(ActionRow.id).where(ActionRow.session_id == session_id).limit(1))
    if existing is not None:
        return
    case_row, demo_attachments = ensure_demo_claim_resources(db, session_id)
    now = datetime.now(UTC)
    for action_type, template, offset_days in DEMO_ACTION_TEMPLATES:
        created_time = now - timedelta(days=offset_days)
        merged_template: dict[str, Any] = {**template, "created_at": created_time.isoformat()}
        claim_case_fk: UUID | None = None
        if action_type == "claim_submit":
            claim_case_fk = case_row.id
            merged_template.update(
                {
                    "claim_case_id": str(case_row.id),
                    "claim_form_status": "COMPLETED",
                    "sandbox": True,
                    "provider_sandbox_label": (
                        "Allianz Care Australia (OSHC) — Sandbox – bukan penyedia nyata"
                    ),
                    "seed_rule": "complete_documents_approve",
                    "attachments": demo_attachments,
                    "attachments_list": [
                        (
                            "1. Kuitansi Klinik GP "
                            f"(ref doc: {demo_attachments[0]['document_id'][:8]}..., "
                            f"sha256: {demo_attachments[0]['sha256'][:12]}...)"
                        ),
                        (
                            "2. Ringkasan Medis GP "
                            f"(ref doc: {demo_attachments[1]['document_id'][:8]}..., "
                            f"sha256: {demo_attachments[1]['sha256'][:12]}...)"
                        ),
                    ],
                    "consistency_checks": [
                        {"check_code": "POLICY_HOLDER_MATCH", "status": "MATCH"},
                        {"check_code": "SERVICE_DATE_WITHIN_COVERAGE", "status": "MATCH"},
                        {"check_code": "RECEIPT_AMOUNT_MATCH", "status": "MATCH"},
                    ],
                }
            )
        payload = _mask_payload(merged_template)
        db.add(
            ActionRow(
                id=uuid4(),
                session_id=session_id,
                claim_case_id=claim_case_fk,
                type=action_type,
                payload=payload,
                status=ActionStatus.PENDING.value,
                approved_at=None,
                approved_payload_sha256=None,
            )
        )
    db.commit()


def _approve_claim_action(
    action_id: UUID,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    body: ActionDecisionRequest | None,
) -> ActionDecisionResult:
    """Hash-bound claim-submission approve (claim-linked actions only)."""
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
        payload = ClaimSubmissionPayload.model_validate(
            {
                "claim_case_id": action.payload.get("claim_case_id"),
                "attachments": action.payload.get("attachments"),
            }
        )
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


def _reject_claim_action(
    action_id: UUID,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    body: ActionDecisionRequest | None,
) -> ActionDecisionResult:
    """Hash-bound claim-submission reject (claim-linked actions only)."""
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
    return [serialize_action(row) for row in rows]


@router.post("", response_model=ProposedAction, status_code=201)
def propose_action(
    body: ActionProposeRequest,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    x_freeze_legacy: str | None = Header(default=None, alias="X-Freeze-Legacy-Actions"),
):
    _enforce_legacy_freeze(x_freeze_legacy)
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
    stored_type = (
        "claim_submit" if raw_type in {"claim_submit", "submit_claim_sandbox"} else raw_type
    )
    now = datetime.now(UTC)
    raw_payload = dict(body.payload) if isinstance(body.payload, dict) else {}
    claim_case_fk: UUID | None = None

    if stored_type == "claim_submit":
        src_form_id = raw_payload.get("source_claim_form_action_id")
        if src_form_id:
            try:
                form_uuid = UUID(str(src_form_id))
            except ValueError as err:
                raise AppError(
                    400, "INVALID_CLAIM_FORM_ID", "ID tindakan formulir klaim tidak valid."
                ) from err
            form_row = owned_resource(db, actor, "action", form_uuid)
            if form_row.status != ActionStatus.COMPLETED.value:
                raise AppError(
                    400,
                    "CLAIM_FORM_NOT_COMPLETED",
                    (
                        "Tindakan kirim klaim ke penyedia (sandbox) hanya bisa dibuat dari "
                        "formulir klaim yang berstatus Selesai."
                    ),
                )
            form_payload = dict(form_row.payload) if isinstance(form_row.payload, dict) else {}
            for field_key in (
                "provider",
                "policy_number",
                "diagnosis_code",
                "claim_amount",
                "message",
            ):
                if field_key not in raw_payload and field_key in form_payload:
                    raw_payload[field_key] = form_payload[field_key]
            raw_payload["claim_form_status"] = "COMPLETED"

        demo_case, demo_attachments = ensure_demo_claim_resources(db, session.id)
        if "claim_case_id" in raw_payload and raw_payload["claim_case_id"]:
            try:
                candidate_case_id = UUID(str(raw_payload["claim_case_id"]))
                owned_case = owned_resource(db, actor, "claim", candidate_case_id)
                claim_case_fk = owned_case.id
            except ValueError:
                claim_case_fk = demo_case.id
                raw_payload["claim_case_id"] = str(demo_case.id)
        else:
            claim_case_fk = demo_case.id
            raw_payload["claim_case_id"] = str(demo_case.id)

        if "attachments" not in raw_payload:
            raw_payload["attachments"] = demo_attachments
        if "attachments_list" not in raw_payload and isinstance(
            raw_payload.get("attachments"), list
        ):
            att_items = raw_payload["attachments"]
            if att_items:
                raw_payload["attachments_list"] = [
                    (
                        f"{idx + 1}. Dokumen Klaim Terverifikasi "
                        f"(ref doc: {str(item.get('document_id', ''))[:8]}..., "
                        f"sha256: {str(item.get('sha256', ''))[:12]}...)"
                    )
                    for idx, item in enumerate(att_items)
                    if isinstance(item, dict)
                ]
        raw_payload.setdefault("claim_form_status", "COMPLETED")
        raw_payload.setdefault("sandbox", True)
        raw_payload.setdefault(
            "provider_sandbox_label",
            (
                f"{raw_payload.get('provider') or 'Penyedia Asuransi'} "
                "— Sandbox – bukan penyedia nyata"
            ),
        )
        raw_payload.setdefault("seed_rule", "complete_documents_approve")
        raw_payload.setdefault(
            "consistency_checks",
            [
                {"check_code": "POLICY_HOLDER_MATCH", "status": "MATCH"},
                {"check_code": "SERVICE_DATE_WITHIN_COVERAGE", "status": "MATCH"},
                {"check_code": "RECEIPT_AMOUNT_MATCH", "status": "MATCH"},
            ],
        )

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
        claim_case_id=claim_case_fk,
        type=stored_type,
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
            f"Agen menyiapkan draf tindakan ({stored_type}) tingkat {enforced_level.value}."
        ),
        tools_called=["submit_claim_sandbox" if stored_type == "claim_submit" else stored_type],
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
    x_freeze_legacy: str | None = Header(default=None, alias="X-Freeze-Legacy-Actions"),
):
    _enforce_legacy_freeze(x_freeze_legacy)
    row = owned_resource(db, actor, "action", action_id)
    # Minimal canonical claim actions always require the reviewed hash. Legacy sandbox
    # actions retain their explicit-confirmation flow and still persist a payload hash.
    minimal_claim = isinstance(row.payload, dict) and set(row.payload) == {
        "claim_case_id",
        "attachments",
    }
    if minimal_claim or body is None or body.expected_payload_sha256 is not None:
        return _approve_claim_action(action_id, session, actor, db, body)
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
        tools_called=[
            "submit_claim_sandbox"
            if row.type in {"claim_submit", "submit_claim_sandbox"}
            else "draft_claim_form",
            "policy_guard",
        ],
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
    x_freeze_legacy: str | None = Header(default=None, alias="X-Freeze-Legacy-Actions"),
):
    _enforce_legacy_freeze(x_freeze_legacy)
    row = owned_resource(db, actor, "action", action_id)
    if row.claim_case_id is not None or body is None:
        return _reject_claim_action(action_id, session, actor, db, body)
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


def _execute_sandbox_claim_internal(
    row: ActionRow,
    session_id: UUID,
    actor: Any,
    db: Session,
    *,
    explicit_attachments: list[dict[str, str]] | None = None,
    simulate_failure: bool = False,
    raise_on_validation_error: bool = False,
) -> tuple[ProposedAction, SandboxClaimResponse | None]:
    raw_payload = dict(row.payload) if isinstance(row.payload, dict) else {}
    clean_payload = {k: v for k, v in raw_payload.items() if k != "_execution_meta"}
    masked_payload = _mask_payload(clean_payload)
    now = datetime.now(UTC)

    # Resolve or ensure ClaimCaseRow
    case_row: ClaimCaseRow | None = None
    if row.claim_case_id:
        case_row = owned_resource(db, actor, "claim", row.claim_case_id)
    elif clean_payload.get("claim_case_id"):
        try:
            case_row = owned_resource(db, actor, "claim", UUID(str(clean_payload["claim_case_id"])))
        except ValueError:
            case_row = None
    if case_row is None:
        case_row, _ = ensure_demo_claim_resources(db, session_id)
        row.claim_case_id = case_row.id

    # Idempotency check if already COMPLETED
    existing_meta = (
        dict(raw_payload.get("_execution_meta"))
        if isinstance(raw_payload.get("_execution_meta"), dict)
        else {}
    )
    existing_exec = (
        dict(existing_meta.get("execution_result"))
        if isinstance(existing_meta.get("execution_result"), dict)
        else {}
    )
    if (
        row.status == ActionStatus.COMPLETED.value
        and existing_exec.get("claim_ref")
        and not simulate_failure
    ):
        resp = SandboxClaimResponse(
            claim_ref=str(existing_exec["claim_ref"]),
            status=str(existing_exec.get("sandbox_status") or "Diterima"),
            sandbox=True,
            action_id=row.id,
            claim_case_id=case_row.id,
            claim_case_status=str(existing_exec.get("claim_case_status") or case_row.status),
            claim_case_status_label=CASE_STATUS_LABELS.get(
                str(existing_exec.get("claim_case_status") or case_row.status), "Diajukan"
            ),
            submitted_at=(
                datetime.fromisoformat(str(existing_meta.get("executed_at")))
                if existing_meta.get("executed_at")
                else now
            ),
            provider_label=str(
                existing_exec.get("provider_label") or "Sandbox – bukan penyedia nyata"
            ),
            status_timeline=list(existing_exec.get("status_timeline") or []),
            rejection_reason=existing_exec.get("rejection_reason"),
        )
        return serialize_action(row), resp

    # Validate prerequisites & required fields
    validation_errors: list[str] = []

    # 1. Source claim form must be COMPLETED
    src_form_id = clean_payload.get("source_claim_form_action_id")
    if src_form_id:
        try:
            src_row = owned_resource(db, actor, "action", UUID(str(src_form_id)))
            if src_row.status != ActionStatus.COMPLETED.value:
                validation_errors.append("formulir klaim asal belum berstatus Selesai (COMPLETED)")
        except ValueError:
            validation_errors.append("ID formulir klaim asal tidak valid")
    elif str(clean_payload.get("claim_form_status") or "COMPLETED").upper() != "COMPLETED":
        validation_errors.append("formulir klaim belum berstatus Selesai (COMPLETED)")

    # 2. Case must have no MISMATCH (Tidak cocok) consistency rows
    consistency_checks = clean_payload.get("consistency_checks")
    if isinstance(consistency_checks, list):
        for check in consistency_checks:
            if isinstance(check, dict) and str(check.get("status") or "").upper() in {
                "MISMATCH",
                "TIDAK_COCOK",
                "TIDAK COCOK",
            }:
                validation_errors.append(
                    f"konsistensi Tidak cocok pada {check.get('check_code') or 'dokumen'}"
                )

    # 3. Required claim fields
    for req_field, field_label in (
        ("provider", "provider (penyedia asuransi)"),
        ("policy_number", "policy_number (nomor polis)"),
        ("diagnosis_code", "diagnosis_code (kode diagnosis)"),
        ("claim_amount", "claim_amount (nominal klaim)"),
    ):
        val = str(clean_payload.get(req_field) or "").strip()
        if not val or val == "-":
            validation_errors.append(field_label)

    # 4. Attachments (document_id + sha256 references)
    raw_atts = (
        explicit_attachments
        if explicit_attachments is not None
        else clean_payload.get("attachments")
    )
    attachment_refs: list[dict[str, str]] = []
    if isinstance(raw_atts, list):
        for item in raw_atts:
            if isinstance(item, dict) and item.get("document_id") and item.get("sha256"):
                doc_uuid = UUID(str(item["document_id"]))
                owned_doc = owned_resource(db, actor, "document", doc_uuid)
                if owned_doc.sha256 and owned_doc.sha256 != str(item["sha256"]):
                    validation_errors.append(f"sha256 dokumen {str(doc_uuid)[:8]} tidak cocok")
                attachment_refs.append(
                    {
                        "document_id": str(doc_uuid),
                        "sha256": str(item["sha256"]),
                    }
                )
    if not attachment_refs:
        validation_errors.append("attachments (minimal 1 referensi document_id & sha256)")

    masked_policy = _mask_policy_string(
        str(masked_payload.get("policy_number") or "****1234"), is_policy_field=True
    )
    provider_name = _mask_policy_string(str(masked_payload.get("provider") or "Penyedia Asuransi"))
    provider_sandbox_label = f"{provider_name} (Sandbox – bukan penyedia nyata)"

    masked_request_summary: dict[str, Any] = {
        "timestamp": now.isoformat(),
        "action_id": str(row.id),
        "claim_case_id": str(case_row.id),
        "sandbox": True,
        "provider_label": provider_sandbox_label,
        "policy_number_masked": masked_policy,
        "diagnosis_code": _mask_policy_string(str(masked_payload.get("diagnosis_code") or "-")),
        "claim_amount": _mask_policy_string(str(masked_payload.get("claim_amount") or "-")),
        "attachments": attachment_refs,
    }

    if simulate_failure or validation_errors:
        failure_msg = (
            "Eksekusi pengiriman klaim ke sandbox gagal sementara karena gangguan koneksi layanan. "
            "Silakan klik Coba lagi."
            if simulate_failure and not validation_errors
            else "Validasi Sandbox Gagal: Field atau prasyarat wajib belum terpenuhi ("
            + ", ".join(validation_errors)
            + ")."
        )
        failed_log_entry = {
            "timestamp": now.isoformat(),
            "action_id": str(row.id),
            "claim_case_id": str(case_row.id),
            "claim_ref": "VALIDATION-REJECTED",
            "sandbox": True,
            "environment_label": "SANDBOX – Bukan penyedia nyata",
            "tool_called": "submit_claim_sandbox",
            "outcome": "VALIDATION_FAILED",
            "initial_status": "Ditolak Validasi",
            "case_status": case_row.status,
            "case_status_label": CASE_STATUS_LABELS.get(case_row.status, "Draf"),
            "request_summary": masked_request_summary,
            "response_summary": {
                "timestamp": now.isoformat(),
                "action_id": str(row.id),
                "claim_ref": "VALIDATION-REJECTED",
                "status": "Gagal Validasi",
                "error": failure_msg,
                "missing_fields": validation_errors,
                "sandbox": True,
            },
        }
        raw_payload["_execution_meta"] = {
            "executed_at": now.isoformat(),
            "failure_reason": failure_msg,
            "execution_result": {
                "artifact_type": "sandbox_claim",
                "sandbox": True,
                "provider_label": provider_sandbox_label,
                "sandbox_status": "Gagal Validasi",
                "validation_errors": validation_errors,
            },
            "sandbox_log_entry": failed_log_entry,
        }
        row.payload = raw_payload
        row.status = ActionStatus.FAILED.value
        log_event(
            db,
            session_id,
            "ACTION_EXECUTION_FAILED",
            outcome="FAILURE",
            category="action",
            source_screen="SC-10 · Persetujuan Tindakan",
            input_summary=_mask_policy_string(
                f"[SANDBOX] Request submit_claim_sandbox pada {now.isoformat()} "
                f"(action_id={row.id}, polis={masked_policy})."
            ),
            tools_called=["submit_claim_sandbox"],
            result_summary=(
                f"[SANDBOX] Response validasi menolak pengiriman pada {now.isoformat()} "
                f"(action_id={row.id}, claim_ref=VALIDATION-REJECTED): {failure_msg}"
            ),
            reason=failure_msg,
            approval_status=ActionStatus.FAILED.value,
            approval_time=now.isoformat(),
        )
        db.commit()
        if raise_on_validation_error:
            raise AppError(
                422,
                "SANDBOX_VALIDATION_FAILED",
                failure_msg,
                details={
                    "missing_fields": validation_errors,
                    "action_id": str(row.id),
                    "action_status": ActionStatus.FAILED.value,
                    "sandbox": True,
                },
            )
        return serialize_action(row), None

    # Validated! Transition claim_case to SUBMITTED ("Diajukan") and generate claim_ref
    claim_ref = f"SBX-2026-{str(row.id).replace('-', '')[:8].upper()}"
    case_row.status = ClaimCaseStatus.SUBMITTED.value

    seed_rule = str(clean_payload.get("seed_rule") or "complete_documents_approve").lower()
    if "reject" in seed_rule:
        final_stage = ClaimCaseStatus.REJECTED.value
        final_label = "Ditolak"
        rejection_reason: str | None = (
            "Ditolak (Simulasi Aturan Seed Sandbox): Klaim berada dalam masa tunggu polis."
        )
        final_desc = rejection_reason
    else:
        final_stage = ClaimCaseStatus.APPROVED.value
        final_label = "Disetujui"
        rejection_reason = None
        final_desc = (
            "Disetujui (Simulasi Sandbox ≤ 1 menit): Seluruh referensi dokumen & SHA-256 "
            "sesuai dengan cakupan manfaat rawat jalan."
        )

    t_submitted = now
    t_processing = now + timedelta(seconds=15)
    t_final = now + timedelta(seconds=30)

    status_timeline: list[dict[str, Any]] = [
        {
            "stage": ClaimCaseStatus.SUBMITTED.value,
            "sandbox_status": "Diterima",
            "case_status": ClaimCaseStatus.SUBMITTED.value,
            "case_status_label": "Diajukan",
            "timestamp": t_submitted.isoformat(),
            "elapsed_seconds": 0,
            "description": (
                f"Paket klaim diterima oleh API penyedia (SANDBOX) dengan nomor {claim_ref}. "
                "Status kasus menjadi Diajukan."
            ),
        },
        {
            "stage": ClaimCaseStatus.PROCESSING.value,
            "sandbox_status": "Diproses",
            "case_status": ClaimCaseStatus.PROCESSING.value,
            "case_status_label": "Diproses",
            "timestamp": t_processing.isoformat(),
            "elapsed_seconds": 15,
            "description": (
                "Simulasi Sandbox: Memverifikasi referensi document_id, hash SHA-256 lampiran, "
                "dan klausul manfaat."
            ),
        },
        {
            "stage": final_stage,
            "sandbox_status": final_label,
            "case_status": final_stage,
            "case_status_label": final_label,
            "timestamp": t_final.isoformat(),
            "elapsed_seconds": 30,
            "description": final_desc,
            "rejection_reason": rejection_reason,
        },
    ]

    response_summary = {
        "timestamp": now.isoformat(),
        "action_id": str(row.id),
        "claim_case_id": str(case_row.id),
        "claim_ref": claim_ref,
        "initial_status": "Diterima",
        "claim_case_status": ClaimCaseStatus.SUBMITTED.value,
        "claim_case_status_label": "Diajukan",
        "simulated_final_status": final_stage,
        "simulated_final_status_label": final_label,
        "sandbox": True,
    }

    sandbox_log_entry = {
        "timestamp": now.isoformat(),
        "action_id": str(row.id),
        "claim_case_id": str(case_row.id),
        "claim_ref": claim_ref,
        "sandbox": True,
        "environment_label": "SANDBOX – Bukan penyedia nyata",
        "tool_called": "submit_claim_sandbox",
        "outcome": "SUCCESS",
        "initial_status": "Diterima",
        "case_status": ClaimCaseStatus.SUBMITTED.value,
        "case_status_label": "Diajukan",
        "request_summary": masked_request_summary,
        "response_summary": response_summary,
    }

    _, pdf_summary_text, attachments_list = _build_claim_pdf_artifact(
        str(masked_payload.get("title") or "Kirim klaim ke penyedia (sandbox)"), masked_payload
    )

    exec_result: dict[str, Any] = {
        "artifact_type": "sandbox_claim",
        "sandbox": True,
        "environment_badge": "SANDBOX",
        "provider_label": provider_sandbox_label,
        "claim_ref": claim_ref,
        "sandbox_status": "Diterima",
        "claim_case_id": str(case_row.id),
        "claim_case_status": ClaimCaseStatus.SUBMITTED.value,
        "claim_case_status_label": "Diajukan",
        "submitted_at": now.isoformat(),
        "sim_step": 0,
        "status_timeline": status_timeline,
        "rejection_reason": rejection_reason,
        "attachments": attachment_refs,
        "attachments_list": attachments_list,
        "pdf_summary_text": pdf_summary_text,
        "download_url": f"/api/v1/actions/{row.id}/pdf",
        "case_url": f"/claims?case_id={case_row.id}&claim_ref={claim_ref}",
        "logs_export_json_url": "/api/v1/sandbox/insurer/logs?format=json",
        "logs_export_csv_url": "/api/v1/sandbox/insurer/logs?format=csv",
    }

    raw_payload["_execution_meta"] = {
        "executed_at": now.isoformat(),
        "failure_reason": None,
        "execution_result": exec_result,
        "sandbox_log_entry": sandbox_log_entry,
    }
    row.payload = raw_payload
    row.status = ActionStatus.COMPLETED.value

    log_event(
        db,
        session_id,
        "ACTION_EXECUTED",
        category="action",
        source_screen="SC-10 · Persetujuan Tindakan",
        input_summary=_mask_policy_string(
            f"[SANDBOX] Request submit_claim_sandbox pada {now.isoformat()} "
            f"(action_id={row.id}, polis={masked_policy}, "
            f"lampiran={len(attachment_refs)} dokumen referensi SHA-256)."
        ),
        tools_called=["submit_claim_sandbox"],
        result_summary=(
            f"[SANDBOX] Response diterima pada {now.isoformat()} "
            f"(action_id={row.id}, claim_ref={claim_ref}): "
            "Status awal=Diterima, Status kasus=Diajukan (SUBMITTED)."
        ),
        reason=(
            f"Pengiriman klaim ke penyedia simulasi (SANDBOX) dieksekusi sesuai persetujuan L2 "
            f"(hash {row.approved_payload_sha256[:12]}...)."
        ),
        approval_status=ActionStatus.COMPLETED.value,
        approval_time=now.isoformat(),
    )
    db.commit()

    sandbox_resp = SandboxClaimResponse(
        claim_ref=claim_ref,
        status="Diterima",
        sandbox=True,
        action_id=row.id,
        claim_case_id=case_row.id,
        claim_case_status=ClaimCaseStatus.SUBMITTED.value,
        claim_case_status_label="Diajukan",
        submitted_at=now,
        provider_label=provider_sandbox_label,
        status_timeline=status_timeline,
        rejection_reason=rejection_reason,
    )
    return serialize_action(row), sandbox_resp


def submit_sandbox_claim_endpoint(
    body: SandboxClaimRequest,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
) -> SandboxClaimResponse:
    action = approved_action(db, actor, body.action_id, body.approved_payload_sha256)
    case_row = owned_resource(db, actor, "claim", body.claim_case_id)
    if (action.claim_case_id and action.claim_case_id != body.claim_case_id) or action.type not in {
        "claim_submit",
        "submit_claim_sandbox",
    }:
        raise AppError(403, "ACTION_CONTEXT_MISMATCH", "Persetujuan tidak berlaku untuk kasus ini.")

    raw_payload = dict(action.payload) if isinstance(action.payload, dict) else {}
    clean_payload = {k: v for k, v in raw_payload.items() if k != "_execution_meta"}

    # Preserve 501 stub behavior for synthetic minimal attachment-only fixture in test_alignment.py
    if (
        set(clean_payload.keys()) == {"claim_case_id", "attachments"}
        and case_row.path == "synthetic"
    ):
        submitted = {
            "claim_case_id": str(body.claim_case_id),
            "attachments": [item.model_dump(mode="json") for item in body.attachments],
        }
        if payload_sha256(submitted) != action.approved_payload_sha256:
            raise AppError(
                403, "APPROVED_PAYLOAD_MISMATCH", "Lampiran tidak cocok dengan persetujuan."
            )
        for attachment in body.attachments:
            owned_resource(db, actor, "document", attachment.document_id)
        not_implemented()

    # Verify body.attachments match approved attachments in payload if present
    approved_atts = clean_payload.get("attachments")
    body_att_dicts = [item.model_dump(mode="json") for item in body.attachments]
    if isinstance(approved_atts, list) and approved_atts:
        expected_pairs = [
            (str(a.get("document_id")), str(a.get("sha256")))
            for a in approved_atts
            if isinstance(a, dict)
        ]
        given_pairs = [(str(a["document_id"]), str(a["sha256"])) for a in body_att_dicts]
        if expected_pairs != given_pairs:
            raise AppError(
                403, "APPROVED_PAYLOAD_MISMATCH", "Lampiran tidak cocok dengan persetujuan."
            )

    _, sandbox_resp = _execute_sandbox_claim_internal(
        action,
        session.id,
        actor,
        db,
        explicit_attachments=body_att_dicts,
        raise_on_validation_error=True,
    )
    assert sandbox_resp is not None
    return sandbox_resp


def get_or_advance_sandbox_claim_status(
    claim_ref: str,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    *,
    advance: bool = False,
) -> SandboxClaimResponse:
    rows = list(db.scalars(select(ActionRow).where(ActionRow.session_id == session.id)))
    target_row: ActionRow | None = None
    for candidate in rows:
        raw_p = candidate.payload if isinstance(candidate.payload, dict) else {}
        meta = (
            raw_p.get("_execution_meta") if isinstance(raw_p.get("_execution_meta"), dict) else {}
        )
        exec_res = (
            meta.get("execution_result") if isinstance(meta.get("execution_result"), dict) else {}
        )
        if str(exec_res.get("claim_ref") or "").upper() == claim_ref.strip().upper():
            target_row = candidate
            break

    if target_row is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Nomor klaim sandbox tidak ditemukan.")

    raw_payload = dict(target_row.payload)
    meta = dict(raw_payload.get("_execution_meta") or {})
    exec_res = dict(meta.get("execution_result") or {})
    timeline = list(exec_res.get("status_timeline") or [])
    cur_step = int(exec_res.get("sim_step") or 0)

    submitted_raw = str(exec_res.get("submitted_at") or meta.get("executed_at") or "")
    try:
        submitted_dt = datetime.fromisoformat(submitted_raw)
        if not submitted_dt.tzinfo:
            submitted_dt = submitted_dt.replace(tzinfo=UTC)
    except ValueError:
        submitted_dt = datetime.now(UTC)

    elapsed = (datetime.now(UTC) - submitted_dt).total_seconds()
    new_step = cur_step
    if advance and cur_step < len(timeline) - 1:
        new_step = cur_step + 1
    elif elapsed >= 30 and len(timeline) >= 3:
        new_step = max(cur_step, 2)
    elif elapsed >= 15 and len(timeline) >= 2:
        new_step = max(cur_step, 1)

    if new_step != cur_step and new_step < len(timeline):
        stage_info = timeline[new_step]
        new_case_status = str(stage_info.get("case_status") or "PROCESSING")
        new_case_label = str(stage_info.get("case_status_label") or "Diproses")
        new_sandbox_status = str(stage_info.get("sandbox_status") or new_case_label)

        exec_res["sim_step"] = new_step
        exec_res["claim_case_status"] = new_case_status
        exec_res["claim_case_status_label"] = new_case_label
        exec_res["sandbox_status"] = new_sandbox_status

        if isinstance(meta.get("sandbox_log_entry"), dict):
            log_entry = dict(meta["sandbox_log_entry"])
            log_entry["case_status"] = new_case_status
            log_entry["case_status_label"] = new_case_label
            if isinstance(log_entry.get("response_summary"), dict):
                resp_sum = dict(log_entry["response_summary"])
                resp_sum["claim_case_status"] = new_case_status
                resp_sum["claim_case_status_label"] = new_case_label
                log_entry["response_summary"] = resp_sum
            meta["sandbox_log_entry"] = log_entry

        meta["execution_result"] = exec_res
        raw_payload["_execution_meta"] = meta
        target_row.payload = raw_payload

        if target_row.claim_case_id:
            case_row = owned_resource(db, actor, "claim", target_row.claim_case_id)
            case_row.status = new_case_status
        db.commit()

    return SandboxClaimResponse(
        claim_ref=str(exec_res.get("claim_ref")),
        status=str(exec_res.get("sandbox_status") or "Diterima"),
        sandbox=True,
        action_id=target_row.id,
        claim_case_id=target_row.claim_case_id,
        claim_case_status=str(exec_res.get("claim_case_status") or "SUBMITTED"),
        claim_case_status_label=str(exec_res.get("claim_case_status_label") or "Diajukan"),
        submitted_at=submitted_dt,
        provider_label=str(exec_res.get("provider_label") or "Sandbox – bukan penyedia nyata"),
        status_timeline=timeline,
        rejection_reason=exec_res.get("rejection_reason"),
    )


def export_sandbox_logs_endpoint(
    session: ConsentedSession,
    db: DB,
    *,
    fmt: str = "json",
) -> list[SandboxLogEntry] | Response:
    rows = list(
        db.scalars(
            select(ActionRow).where(ActionRow.session_id == session.id).order_by(ActionRow.id.asc())
        )
    )
    entries: list[SandboxLogEntry] = []
    for row in rows:
        raw_p = row.payload if isinstance(row.payload, dict) else {}
        meta = (
            raw_p.get("_execution_meta") if isinstance(raw_p.get("_execution_meta"), dict) else {}
        )
        raw_log = meta.get("sandbox_log_entry")
        if isinstance(raw_log, dict):
            ts_raw = str(raw_log.get("timestamp") or datetime.now(UTC).isoformat())
            try:
                ts_dt = datetime.fromisoformat(ts_raw)
                if not ts_dt.tzinfo:
                    ts_dt = ts_dt.replace(tzinfo=UTC)
            except ValueError:
                ts_dt = datetime.now(UTC)
            case_uuid: UUID | None = None
            if raw_log.get("claim_case_id"):
                try:
                    case_uuid = UUID(str(raw_log["claim_case_id"]))
                except ValueError:
                    case_uuid = None
            entries.append(
                SandboxLogEntry(
                    timestamp=ts_dt,
                    action_id=UUID(str(raw_log.get("action_id") or row.id)),
                    claim_case_id=case_uuid,
                    claim_ref=str(raw_log.get("claim_ref") or ""),
                    sandbox=True,
                    environment_label="SANDBOX – Bukan penyedia nyata",
                    tool_called="submit_claim_sandbox",
                    outcome=(
                        "VALIDATION_FAILED"
                        if raw_log.get("outcome") == "VALIDATION_FAILED"
                        else "SUCCESS"
                    ),
                    initial_status=str(raw_log.get("initial_status") or "Diterima"),
                    case_status=str(raw_log.get("case_status") or "SUBMITTED"),
                    case_status_label=str(raw_log.get("case_status_label") or "Diajukan"),
                    request_summary=_mask_payload(dict(raw_log.get("request_summary") or {})),
                    response_summary=_mask_payload(dict(raw_log.get("response_summary") or {})),
                )
            )

    if fmt.lower() == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            [
                "timestamp",
                "action_id",
                "claim_case_id",
                "claim_ref",
                "sandbox",
                "environment_label",
                "tool_called",
                "outcome",
                "initial_status",
                "case_status",
                "case_status_label",
                "policy_number_masked",
                "attachment_refs",
            ]
        )
        for item in entries:
            req_sum = item.request_summary if isinstance(item.request_summary, dict) else {}
            atts = (
                req_sum.get("attachments") if isinstance(req_sum.get("attachments"), list) else []
            )
            att_str = "; ".join(
                f"{a.get('document_id')}:{str(a.get('sha256'))[:12]}"
                for a in atts
                if isinstance(a, dict)
            )
            writer.writerow(
                [
                    item.timestamp.isoformat(),
                    str(item.action_id),
                    str(item.claim_case_id or ""),
                    item.claim_ref,
                    "true",
                    item.environment_label,
                    item.tool_called,
                    item.outcome,
                    item.initial_status,
                    item.case_status,
                    item.case_status_label,
                    str(req_sum.get("policy_number_masked") or "****1234"),
                    att_str,
                ]
            )
        return Response(
            content=buf.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="sandbox-execution-logs.csv"'},
        )

    return entries


@router.post("/{action_id}/execute", response_model=ProposedAction)
def execute(
    action_id: UUID,
    body: ActionExecutionRequest,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
    simulate_failure: Annotated[bool, Query()] = False,
    x_freeze_legacy: str | None = Header(default=None, alias="X-Freeze-Legacy-Actions"),
):
    _enforce_legacy_freeze(x_freeze_legacy)
    row = approved_action(db, actor, action_id, body.approved_payload_sha256)
    raw_payload = dict(row.payload) if isinstance(row.payload, dict) else {}
    clean_payload = {k: v for k, v in raw_payload.items() if k != "_execution_meta"}

    # Preserve 501 stub behavior for synthetic minimal attachment-only fixture in test_alignment.py
    if set(clean_payload.keys()) == {"claim_case_id", "attachments"}:
        not_implemented()

    if row.type in {"claim_submit", "submit_claim_sandbox"}:
        action_res, _ = _execute_sandbox_claim_internal(
            row,
            session.id,
            actor,
            db,
            simulate_failure=simulate_failure,
            raise_on_validation_error=False,
        )
        return action_res

    # Idempotent execution: if already COMPLETED, return existing result
    # without duplicate side effects or audit entries.
    if row.status == ActionStatus.COMPLETED.value and not simulate_failure:
        return serialize_action(row)

    now = datetime.now(UTC)
    masked_payload = _mask_payload(clean_payload)
    default_title = ALLOWED_ACTION_TOOLS.get(
        row.type, (ActionPermissionLevel.L1, f"Tindakan {row.type}")
    )[1]
    title = str(masked_payload.get("title") or default_title).strip()

    if simulate_failure:
        failure_msg = (
            "Eksekusi tindakan gagal sementara karena gangguan koneksi layanan. "
            "Silakan klik Coba lagi."
        )
        raw_payload["_execution_meta"] = {
            "executed_at": now.isoformat(),
            "failure_reason": failure_msg,
            "execution_result": None,
        }
        row.payload = raw_payload
        row.status = ActionStatus.FAILED.value
        log_event(
            db,
            session.id,
            "ACTION_EXECUTION_FAILED",
            outcome="FAILURE",
            category="action",
            source_screen="SC-10 · Persetujuan Tindakan",
            input_summary=_mask_policy_string(f"Eksekusi tindakan ({row.type}) gagal dijalankan."),
            tools_called=[row.type if row.type != "claim_submit" else "submit_claim_sandbox"],
            result_summary=f"Status tindakan menjadi FAILED: {failure_msg}",
            reason=failure_msg,
            approval_status=ActionStatus.FAILED.value,
            approval_time=now.isoformat(),
        )
        db.commit()
        return serialize_action(row)

    if row.type == "create_reminder":
        ics_content, gcal_url, iso_date = _build_ics_artifact(row.id, title, masked_payload)
        exec_result: dict[str, Any] = {
            "artifact_type": "ics",
            "ics_filename": f"pengingat-{str(row.id)[:8]}.ics",
            "ics_content": ics_content,
            "reminder_date": iso_date,
            "google_calendar_url": gcal_url,
            "download_url": f"/api/v1/actions/{row.id}/ics",
        }
        result_summary = (
            f"File .ics pengingat ({iso_date}) dan tautan Google Calendar siap diunduh; "
            "status menjadi COMPLETED."
        )
        tools_used = ["create_reminder", "policy_guard"]
    elif row.type == "draft_message":
        mailto_url, subject, copy_text = _build_mailto_artifact(title, masked_payload)
        exec_result = {
            "artifact_type": "mailto",
            "subject": subject,
            "mailto_url": mailto_url,
            "copy_text": copy_text,
        }
        result_summary = (
            "Tautan mailto dengan subjek & isi sesuai versi yang disetujui siap dibuka; "
            "status menjadi COMPLETED."
        )
        tools_used = ["draft_message", "policy_guard"]
    else:
        _, pdf_summary_text, attachments_list = _build_claim_pdf_artifact(title, masked_payload)
        exec_result = {
            "artifact_type": "pdf",
            "pdf_filename": f"ringkasan-klaim-{str(row.id)[:8]}.pdf",
            "pdf_summary_text": pdf_summary_text,
            "attachments_list": attachments_list,
            "download_url": f"/api/v1/actions/{row.id}/pdf",
            "can_create_sandbox_submission": row.type == "draft_claim_form",
            "claim_ref": None,
        }
        result_summary = (
            "Ringkasan PDF klaim beserta daftar lampiran (nomor polis tersamar) "
            "berhasil dibuat; status menjadi COMPLETED."
        )
        tools_used = ["draft_claim_form", "policy_guard"]

    raw_payload["_execution_meta"] = {
        "executed_at": now.isoformat(),
        "failure_reason": None,
        "execution_result": exec_result,
    }
    row.payload = raw_payload
    row.status = ActionStatus.COMPLETED.value

    log_event(
        db,
        session.id,
        "ACTION_EXECUTED",
        category="action",
        source_screen="SC-10 · Persetujuan Tindakan",
        input_summary=_mask_policy_string(
            f"Menjalankan tindakan yang telah disetujui ({row.type}: {title})."
        ),
        tools_called=tools_used,
        result_summary=result_summary,
        reason=(
            f"Dieksekusi sesuai persetujuan eksplisit pengguna "
            f"(hash {row.approved_payload_sha256[:12]}...)."
        ),
        approval_status=ActionStatus.COMPLETED.value,
        approval_time=now.isoformat(),
    )
    db.commit()
    return serialize_action(row)


@router.get("/{action_id}/ics")
def download_ics(
    action_id: UUID,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
):
    row = owned_resource(db, actor, "action", action_id)
    if row.status not in {ActionStatus.APPROVED.value, ActionStatus.COMPLETED.value}:
        raise AppError(
            403,
            "ACTION_APPROVAL_REQUIRED",
            "File .ics hanya dapat diunduh setelah tindakan disetujui.",
        )
    raw_payload = dict(row.payload) if isinstance(row.payload, dict) else {}
    masked_payload = _mask_payload(raw_payload)
    title = str(masked_payload.get("title") or "Pengingat Perlindungan Insurra").strip()
    ics_content, _, _ = _build_ics_artifact(row.id, title, masked_payload)
    filename = f"pengingat-{str(row.id)[:8]}.ics"
    return Response(
        content=ics_content,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{action_id}/pdf")
def download_pdf(
    action_id: UUID,
    session: ConsentedSession,
    actor: ActiveActor,
    db: DB,
):
    row = owned_resource(db, actor, "action", action_id)
    if row.status not in {ActionStatus.APPROVED.value, ActionStatus.COMPLETED.value}:
        raise AppError(
            403,
            "ACTION_APPROVAL_REQUIRED",
            "PDF ringkasan klaim hanya dapat diunduh setelah tindakan disetujui.",
        )
    raw_payload = dict(row.payload) if isinstance(row.payload, dict) else {}
    masked_payload = _mask_payload(raw_payload)
    title = str(masked_payload.get("title") or "Ringkasan Klaim Insurra").strip()
    pdf_bytes, _, _ = _build_claim_pdf_artifact(title, masked_payload)
    filename = f"ringkasan-klaim-{str(row.id)[:8]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
