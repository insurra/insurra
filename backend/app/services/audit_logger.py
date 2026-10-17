from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.models import AuditRow
from app.services.policy_guard import PolicyGuard


def log_event(db: Session, session_id: UUID, event_type: str, outcome: str = "SUCCESS", **metadata):
    db.add(
        AuditRow(
            id=uuid4(),
            session_id=session_id,
            event_type=event_type,
            outcome=outcome,
            event_metadata=PolicyGuard().redact_audit_metadata(metadata),
            created_at=datetime.now(UTC),
        )
    )
