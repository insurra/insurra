from datetime import datetime
from enum import StrEnum
from uuid import UUID

from app.schemas.common import Contract


class ActionStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    COMPLETED = "COMPLETED"


class ProposedAction(Contract):
    id: UUID
    action_type: str
    status: ActionStatus
    preview: str
    created_at: datetime
    approved_at: datetime | None = None
