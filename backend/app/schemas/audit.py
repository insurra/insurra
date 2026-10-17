from datetime import datetime
from uuid import UUID

from pydantic import JsonValue

from app.schemas.common import Contract


class AuditEvent(Contract):
    id: UUID
    session_id: UUID
    event_type: str
    outcome: str
    metadata: dict[str, JsonValue]
    created_at: datetime
