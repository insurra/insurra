from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, JsonValue

from app.schemas.common import Contract

AuditCategory = Literal["answer", "compare", "action", "guardrail", "deletion", "consent"]


class AuditEvent(Contract):
    id: UUID
    session_id: UUID
    event_type: str
    outcome: str
    metadata: dict[str, JsonValue]
    created_at: datetime
    category: AuditCategory | None = None
    source_screen: str | None = None
    input_summary: str | None = None
    tools_called: list[str] = Field(default_factory=list)
    result_summary: str | None = None
    reason: str | None = None
    approval_status: str | None = None
