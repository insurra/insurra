from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.models import AccountAuditRow, AuditRow
from app.schemas.actor import Actor
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


def log_actor_event(db: Session, actor: Actor, event_type: str, **metadata):
    """Operational codes/counts only. Free-form content is never an accepted field."""
    import re

    clean = {}
    for key, value in metadata.items():
        if key in {"citation_count", "point_count", "match_count"} and type(value) is int:
            clean[key] = value
        elif (
            key in {"subtype", "rule_id", "kb_version", "red_flag_id", "label"}
            and isinstance(value, str)
            and re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", value)
        ):
            clean[key] = value
    if actor.account_id:
        db.add(
            AccountAuditRow(account_id=actor.account_id, event_type=event_type, metadata_json=clean)
        )
    else:
        db.add(
            AuditRow(
                id=uuid4(),
                session_id=actor.session_id,
                event_type=event_type,
                outcome="SUCCESS",
                event_metadata=clean,
                created_at=datetime.now(UTC),
            )
        )
