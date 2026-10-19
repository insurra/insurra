from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, select

from app.core.dependencies import DB, ActiveSession
from app.models import AuditRow
from app.schemas.audit import AuditEvent
from app.services.audit_logger import enrich_audit_event

router = APIRouter(prefix="/audit", tags=["Audit"])


@router.get(
    "",
    response_model=list[AuditEvent],
    responses={
        200: {
            "headers": {
                "X-Total-Count": {
                    "schema": {"type": "integer"},
                    "description": "Scoped filtered event count",
                },
            }
        }
    },
)
def audit(
    db: DB,
    session: ActiveSession,
    response: Response,
    event_type: Annotated[str | None, Query(max_length=100)] = None,
    category: Annotated[
        Literal["answer", "compare", "action", "guardrail", "deletion", "consent"] | None,
        Query(alias="type"),
    ] = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    query = select(AuditRow).where(AuditRow.session_id == session.id)
    if event_type:
        query = query.where(AuditRow.event_type == event_type)
    if category:
        # Only operational event names are classified; never inspect question/document text.
        prefix = {
            "consent": "CONSENT",
            "answer": "ANSWER",
            "compare": "COMPARE",
            "action": "ACTION",
            "guardrail": "GUARDRAIL",
            "deletion": "DELETION",
        }[category]
        query = query.where(
            (AuditRow.event_type == prefix) | AuditRow.event_type.startswith(prefix + "_")
        )
    response.headers["X-Total-Count"] = str(
        db.scalar(select(func.count()).select_from(query.subquery()))
    )
    query = query.order_by(AuditRow.created_at.desc(), AuditRow.id).offset(offset)
    if limit is not None:
        query = query.limit(limit)
    return [
        enrich_audit_event(
            id=row.id,
            session_id=row.session_id,
            event_type=row.event_type,
            outcome=row.outcome,
            metadata=row.event_metadata,
            created_at=row.created_at,
        )
        for row in db.scalars(query)
    ]
