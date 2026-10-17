from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import Field

from app.schemas.common import Contract


class ClaimStatus(StrEnum):
    DRAFT = "DRAFT"
    INCOMPLETE = "INCOMPLETE"
    READY_FOR_REVIEW = "READY_FOR_REVIEW"


class ChecklistStatus(StrEnum):
    COMPLETE = "COMPLETE"
    MISSING = "MISSING"
    NEEDS_CHECK = "NEEDS_CHECK"


class ClaimChecklistItem(Contract):
    requirement_code: str
    label: str
    status: ChecklistStatus


class ClaimDraftRequest(Contract):
    selected_pathway_code: str = Field(min_length=1, max_length=100)


class Claim(Contract):
    id: UUID
    profile_id: UUID
    selected_pathway_code: str
    status: ClaimStatus
    checklist_items: list[ClaimChecklistItem]
    created_at: datetime
    updated_at: datetime
