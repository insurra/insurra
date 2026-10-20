from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, or_, select

from app.core.dependencies import DB, ActiveSession
from app.models import AuditRow
from app.schemas.audit import AuditEvent
from app.services.audit_logger import (
    CATEGORY_EVENT_TYPES,
    enrich_audit_event,
    ensure_demo_guardrail_events,
)

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
    if category == "guardrail":
        ensure_demo_guardrail_events(db, session.id)
    query = select(AuditRow).where(AuditRow.session_id == session.id)
    if event_type:
        query = query.where(AuditRow.event_type == event_type)
    if category:
        # Only operational event names are classified; never inspect question/document text.
        if category == "guardrail":
            prefixes = CATEGORY_EVENT_TYPES["guardrail"]
            clauses = []
            for p in prefixes:
                clauses.append(AuditRow.event_type == p)
                clauses.append(AuditRow.event_type.startswith(p + "_"))
            query = query.where(or_(*clauses))
        else:
            prefix = {
                "consent": "CONSENT",
                "answer": "ANSWER",
                "compare": "COMPARE",
                "action": "ACTION",
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


@router.post("/demo-guardrails", response_model=list[AuditEvent])
def run_demo_guardrail_scenario(db: DB, session: ActiveSession):
    ensure_demo_guardrail_events(db, session.id)
    prefixes = CATEGORY_EVENT_TYPES["guardrail"]
    clauses = []
    for p in prefixes:
        clauses.append(AuditRow.event_type == p)
        clauses.append(AuditRow.event_type.startswith(p + "_"))
    query = (
        select(AuditRow)
        .where(AuditRow.session_id == session.id, or_(*clauses))
        .order_by(AuditRow.created_at.desc(), AuditRow.id)
    )
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


@router.get("/events")
def list_audit_events(
    db: DB,
    session: ActiveSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    query = (
        select(AuditRow)
        .where(AuditRow.session_id == session.id)
        .order_by(AuditRow.created_at.desc(), AuditRow.id)
        .limit(limit)
        .offset(offset)
    )
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
