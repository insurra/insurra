from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.core.dependencies import DB, ActiveSession
from app.models import AuditRow
from app.schemas.audit import AuditEvent

router = APIRouter(prefix="/audit", tags=["Audit"])


@router.get("", response_model=list[AuditEvent])
def audit(
    db: DB, session: ActiveSession, event_type: Annotated[str | None, Query(max_length=100)] = None
):
    query = select(AuditRow).where(AuditRow.session_id == session.id)
    if event_type:
        query = query.where(AuditRow.event_type == event_type)
    return [
        AuditEvent(
            id=row.id,
            session_id=row.session_id,
            event_type=row.event_type,
            outcome=row.outcome,
            metadata=row.event_metadata,
            created_at=row.created_at,
        )
        for row in db.scalars(query.order_by(AuditRow.created_at.desc(), AuditRow.id))
    ]
