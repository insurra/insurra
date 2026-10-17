from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import Field, JsonValue, model_validator

from app.schemas.common import CompletenessStatus, Contract


class ProcessingStatus(StrEnum):
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class DocumentSummary(Contract):
    id: UUID
    document_type: str
    original_filename: str
    processing_status: ProcessingStatus
    synthetic: bool = False


class Document(DocumentSummary):
    owner_session_id: UUID
    mime_type: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    detected_language: str | None = None
    uploaded_at: datetime
    processed_at: datetime | None = None
    extraction_error: str | None = None
    extracted_fields: list["ExtractedField"] = Field(default_factory=list)


class SourceEvidence(Contract):
    document_id: UUID
    page_number: int | None = Field(default=None, ge=1)
    original_text: str = Field(min_length=1)
    source_field: str | None = None


class ExtractedField(Contract):
    field_name: str
    value: JsonValue = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    status: CompletenessStatus
    evidence: SourceEvidence | None = None

    @model_validator(mode="after")
    def conservative_status(self):
        if self.value is None and self.status == CompletenessStatus.FOUND:
            raise ValueError("FOUND requires a value")
        if self.confidence is not None and self.confidence < 0.8:
            self.status = CompletenessStatus.UNVERIFIED
        if self.status == CompletenessStatus.FOUND and self.evidence is None:
            self.status = CompletenessStatus.UNVERIFIED
        return self


Document.model_rebuild()
