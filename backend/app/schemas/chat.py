from enum import StrEnum
from uuid import UUID

from pydantic import Field

from app.schemas.common import Contract


class PolicyQuestionRequest(Contract):
    question: str = Field(min_length=1, max_length=4000)


class AnswerCertainty(StrEnum):
    FROM_DOCUMENT = "FROM_DOCUMENT"
    ESTIMATE = "ESTIMATE"
    NEEDS_CONFIRMATION = "NEEDS_CONFIRMATION"


class PolicyCitation(Contract):
    document_id: UUID
    page_number: int | None = Field(default=None, ge=1)
    original_quote: str = Field(min_length=1)


class PolicyAnswer(Contract):
    answer: str
    certainty: AnswerCertainty
    citations: list[PolicyCitation]
    requires_human_confirmation: bool
    warnings: list[str]
