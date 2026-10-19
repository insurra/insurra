from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import JsonValue

from app.schemas.common import Contract


class ActionStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ActionPermissionLevel(StrEnum):
    L0 = "L0"
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"


class ActionDecisionResult(Contract):
    status: ActionStatus


class ProposedAction(Contract):
    id: UUID
    action_type: str
    status: ActionStatus
    preview: str
    created_at: datetime
    approved_at: datetime | None = None
    payload: dict[str, JsonValue] | None = None
    reason: str | None = None
    permission_level: ActionPermissionLevel | None = None
    source_screen: str | None = None
    approved_payload_sha256: str | None = None
    title: str | None = None
    is_stale: bool = False
    stale_label: str | None = None


class ActionProposeRequest(Contract):
    action_type: str
    title: str | None = None
    reason: str | None = None
    source_screen: str | None = None
    permission_level: str | None = None
    payload: dict[str, JsonValue] | None = None
