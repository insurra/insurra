from typing import Any
from uuid import UUID

from app.core.errors import AppError
from app.schemas.action import ActionStatus, ProposedAction
from app.schemas.document import SourceEvidence
from app.services.kb_loader import CountryKBLoader


class PolicyGuard:
    def require_active_consent(self, active: bool) -> None:
        if not active:
            raise AppError(403, "CONSENT_REQUIRED", "Persetujuan pemrosesan diperlukan.")

    def validate_session_access(self, session_id: UUID, owner_session_id: UUID) -> None:
        if session_id != owner_session_id:
            raise AppError(403, "SESSION_ACCESS_DENIED", "Data bukan milik sesi aktif.")

    def validate_evidence_reference(
        self,
        evidence: SourceEvidence,
        allowed_document_ids: set[UUID],
        original_page_text: str | None = None,
    ) -> None:
        if evidence.document_id not in allowed_document_ids:
            raise AppError(403, "EVIDENCE_ACCESS_DENIED", "Dokumen bukti di luar sesi aktif.")
        # Metadata alone cannot prove a quotation. Phase 2 supplies the exact extracted page.
        if original_page_text is None or evidence.original_text not in original_page_text:
            raise AppError(422, "EVIDENCE_UNVERIFIED", "Kutipan belum cocok dengan teks sumber.")

    def validate_action_approval(self, action: ProposedAction) -> None:
        if action.status != ActionStatus.APPROVED or action.approved_at is None:
            raise AppError(
                403, "ACTION_APPROVAL_REQUIRED", "Tindakan memerlukan persetujuan eksplisit."
            )

    def enforce_supported_country(self, country_code: str, loader: CountryKBLoader) -> None:
        loader.load(country_code)

    def redact_audit_metadata(self, metadata: dict[str, Any]) -> dict[str, Any]:
        # Allow-list scalar operational facts; unknown/nested content is dropped entirely.
        output: dict[str, Any] = {}
        allowed_values = {
            "assessment_status": {"PASS", "GAP_FOUND", "NEEDS_VERIFICATION", "NOT_APPLICABLE"},
            "feature": {"documents", "chat", "care", "claims", "actions"},
        }
        for key, value in metadata.items():
            if key in {"processing_consent", "changed"} and isinstance(value, bool):
                output[key] = value
            elif key == "gap_days" and (value is None or type(value) is int):
                output[key] = value
            elif key in allowed_values and isinstance(value, str) and value in allowed_values[key]:
                output[key] = value
        return output

    # Fail-closed extension points. No claim of completed medical or injection safeguards.
    def emergency_triage(self, *_args, **_kwargs):
        raise AppError(
            501, "TRIAGE_NOT_IMPLEMENTED", "Pemeriksaan darurat belum diimplementasikan."
        )

    def prompt_injection_detection(self, *_args, **_kwargs):
        raise AppError(
            501, "INJECTION_GUARD_NOT_IMPLEMENTED", "Pemeriksaan injeksi belum tersedia."
        )

    def citation_validation(self, *_args, **_kwargs):
        raise AppError(
            501, "CITATION_VALIDATION_NOT_IMPLEMENTED", "Validasi kutipan menunggu ekstraksi."
        )

    def action_execution_authorization(self, *_args, **_kwargs):
        raise AppError(501, "ACTION_EXECUTION_NOT_IMPLEMENTED", "Eksekusi tindakan belum tersedia.")
