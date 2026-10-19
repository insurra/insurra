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

    @staticmethod
    def mask_sensitive_numbers(text: str) -> str:
        """Mask policy/card numbers (6+ digits or alphanumeric IDs with 4+ digits) to ****1234."""
        import re

        def _replacer(match: re.Match[str]) -> str:
            token = match.group(0)
            # Keep ISO dates like 2026-10-01 intact
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", token):
                return token
            digits_and_chars = re.sub(r"[\s\-]", "", token)
            digit_count = sum(ch.isdigit() for ch in digits_and_chars)
            if digit_count >= 5 and len(digits_and_chars) >= 6:
                return f"****{digits_and_chars[-4:]}"
            return token

        return re.sub(r"\b[A-Za-z0-9][A-Za-z0-9\-\s]{4,}[A-Za-z0-9]\b", _replacer, text)

    def redact_audit_metadata(self, metadata: dict[str, Any]) -> dict[str, Any]:
        # Allow-list scalar operational facts; unknown/nested content is dropped entirely.
        output: dict[str, Any] = {}
        allowed_values = {
            "assessment_status": {"PASS", "GAP_FOUND", "NEEDS_VERIFICATION", "NOT_APPLICABLE"},
            "feature": {"documents", "chat", "care", "claims", "actions"},
            "purpose": {"process_documents", "external_ai", "retention"},
            "policy_version": {"1.5", "legacy-v1"},
            "category": {"answer", "compare", "action", "guardrail", "deletion", "consent"},
            "approval_status": {"PENDING", "APPROVED", "REJECTED", "COMPLETED", "FAILED"},
            "verification_status": {"VERIFIED", "UNVERIFIED"},
        }
        allowed_tools = {
            "classify_document",
            "extract_text_or_ocr",
            "extract_to_schema",
            "check_completeness",
            "retrieve_clause",
            "rules_engine",
            "compare_paths",
            "gap_matrix",
            "triage_check",
            "draft_claim_form",
            "create_reminder",
            "draft_message",
            "hash_to_testnet",
            "policy_guard",
            "consent_manager",
            "storage_cleaner",
        }
        masked_text_keys = {
            "input_summary",
            "output_summary",
            "result_summary",
            "reason",
            "policy_number_masked",
        }
        plain_str_keys = {
            "source_screen",
            "screen_label",
            "country_code",
            "task_code",
            "field_key",
            "document_id",
            "member_id",
            "relation",
            "kind",
            "rule_id",
            "document_name",
            "approval_time",
        }
        int_keys = {"gap_days", "page_count", "extracted_count", "document_count", "field_count"}
        bool_keys = {
            "processing_consent",
            "changed",
            "granted",
            "skip",
            "corrected",
            "injection_flag",
            "process_documents",
            "external_ai",
            "retention",
        }
        for key, value in metadata.items():
            if key in bool_keys and isinstance(value, bool):
                output[key] = value
            elif key in int_keys and (value is None or type(value) is int):
                output[key] = value
            elif key in allowed_values and isinstance(value, str) and value in allowed_values[key]:
                output[key] = value
            elif key == "tools_called" and isinstance(value, list):
                clean_tools = [t for t in value if isinstance(t, str) and t in allowed_tools]
                output[key] = clean_tools[:10]
            elif key == "citations" and isinstance(value, list):
                clean_citations = []
                for item in value[:10]:
                    if isinstance(item, dict):
                        doc_title = str(item.get("document_name") or item.get("doc") or "")[:120]
                        page_val = item.get("page")
                        quote_val = self.mask_sensitive_numbers(str(item.get("quote") or "")[:300])
                        parsed_page = (
                            page_val
                            if isinstance(page_val, int)
                            else (
                                int(page_val)
                                if isinstance(page_val, str) and page_val.isdigit()
                                else 1
                            )
                        )
                        clean_citations.append(
                            {
                                "document_name": doc_title,
                                "page": parsed_page,
                                "quote": quote_val,
                            }
                        )
                output[key] = clean_citations
            elif key in masked_text_keys and isinstance(value, str):
                output[key] = self.mask_sensitive_numbers(value.strip()[:300])
            elif key in plain_str_keys and isinstance(value, str):
                output[key] = value.strip()[:120]
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
