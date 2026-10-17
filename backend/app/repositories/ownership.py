"""Do not disclose whether a foreign object exists. Never trust a body-supplied owner."""

import hmac
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import ActionRow, AuditRow, ClaimCaseRow, DocumentRow, ExtractedFieldRow
from app.repositories.session_data import insurance_row
from app.schemas.actor import Actor, ActorType
from app.services.approval import payload_sha256


def owned_resource(db: Session, actor: Actor, kind: str, resource_id: UUID):
    if actor.actor_type != ActorType.DEMO_SESSION or actor.session_id is None:
        raise AppError(401, "ACTOR_NOT_SUPPORTED", "Autentikasi akun belum tersedia.")
    models = {
        "document": DocumentRow,
        "field": ExtractedFieldRow,
        "claim": ClaimCaseRow,
        "action": ActionRow,
        "audit": AuditRow,
    }
    if kind == "coverage":
        record = insurance_row(db, actor.session_id).payload
        found = next((p for p in record["policies"] if p["id"] == str(resource_id)), None)
    else:
        model = models[kind]
        found = db.scalar(
            select(model).where(model.id == resource_id, model.session_id == actor.session_id)
        )
        if found is None and kind == "document":
            record = insurance_row(db, actor.session_id).payload
            found = next((d for d in record["documents"] if d["id"] == str(resource_id)), None)
    if found is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Data tidak ditemukan pada sesi aktif.")
    return found


def approved_action(db: Session, actor: Actor, action_id: UUID, approved_payload_sha256: str):
    action = owned_resource(db, actor, "action", action_id)
    if (
        action.status != "APPROVED"
        or action.approved_at is None
        or not action.approved_payload_sha256
    ):
        raise AppError(403, "ACTION_APPROVAL_REQUIRED", "Tindakan belum disetujui di server.")
    if not hmac.compare_digest(action.approved_payload_sha256, payload_sha256(action.payload)):
        raise AppError(
            403, "APPROVED_PAYLOAD_MISMATCH", "Payload server berubah setelah persetujuan."
        )
    if not hmac.compare_digest(action.approved_payload_sha256, approved_payload_sha256):
        raise AppError(
            403, "APPROVED_PAYLOAD_MISMATCH", "Versi payload tidak cocok dengan persetujuan."
        )
    return action
