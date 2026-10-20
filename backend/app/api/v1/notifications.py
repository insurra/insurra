"""Owner-scoped in-app notifications for account and demo actors."""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.dependencies import DB
from app.core.errors import AppError
from app.models import NotificationRow
from app.schemas.notifications import (
    Notification,
    NotificationFilter,
    NotificationPage,
    NotificationsMarked,
    UnreadCount,
)
from app.services.actor_scope import is_demo_actor, owner_where
from app.services.events import sync_reminders
from app.services.workspace import WorkspaceActor

router = APIRouter(prefix="/notifications", tags=["Notifications"])

_CATEGORY_FILTERS = {
    NotificationFilter.ACTION_REQUIRED: "ACTION_REQUIRED",
    NotificationFilter.CLAIMS: "CLAIMS",
    NotificationFilter.PROTECTION: "PROTECTION",
    NotificationFilter.SYSTEM: "SYSTEM",
}


def _view(row: NotificationRow, demo: bool) -> Notification:
    return Notification(
        id=row.id,
        type=row.type,
        category=row.category,
        priority=row.priority,
        title=row.title,
        body=row.body,
        entity_type=row.entity_type,
        entity_id=row.entity_id,
        deep_link=row.deep_link,
        created_at=row.created_at,
        read_at=row.read_at,
        is_read=row.read_at is not None,
        is_demo=demo,
    )


def _unread(db: Session, actor) -> int:
    return (
        db.scalar(
            select(func.count(NotificationRow.id)).where(
                owner_where(NotificationRow, actor), NotificationRow.read_at.is_(None)
            )
        )
        or 0
    )


def _owned(db: Session, actor, notification_id: UUID) -> NotificationRow:
    row = db.scalar(
        select(NotificationRow).where(
            owner_where(NotificationRow, actor), NotificationRow.id == notification_id
        )
    )
    if row is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Notification not found.")
    return row


@router.get("", response_model=NotificationPage)
def list_notifications(
    db: DB,
    actor: WorkspaceActor,
    filter: Annotated[NotificationFilter, Query()] = NotificationFilter.ALL,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    if sync_reminders(db, actor):
        db.commit()
    clauses = [owner_where(NotificationRow, actor)]
    if filter == NotificationFilter.UNREAD:
        clauses.append(NotificationRow.read_at.is_(None))
    elif filter in _CATEGORY_FILTERS:
        clauses.append(NotificationRow.category == _CATEGORY_FILTERS[filter])
    total = db.scalar(select(func.count(NotificationRow.id)).where(*clauses)) or 0
    rows = db.scalars(
        select(NotificationRow)
        .where(*clauses)
        .order_by(NotificationRow.created_at.desc(), NotificationRow.id)
        .limit(limit)
        .offset(offset)
    )
    demo = is_demo_actor(actor)
    return NotificationPage(
        items=[_view(row, demo) for row in rows],
        total=total,
        unread_count=_unread(db, actor),
        limit=limit,
        offset=offset,
    )


@router.get("/unread-count", response_model=UnreadCount)
def unread_count(db: DB, actor: WorkspaceActor):
    if sync_reminders(db, actor):
        db.commit()
    return UnreadCount(unread_count=_unread(db, actor))


@router.post("/read-all", response_model=NotificationsMarked)
def read_all(db: DB, actor: WorkspaceActor):
    result = db.execute(
        update(NotificationRow)
        .where(owner_where(NotificationRow, actor), NotificationRow.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    db.commit()
    return NotificationsMarked(updated=result.rowcount or 0, unread_count=_unread(db, actor))


@router.post("/{notification_id}/read", response_model=Notification)
def mark_read(notification_id: UUID, db: DB, actor: WorkspaceActor):
    row = _owned(db, actor, notification_id)
    if row.read_at is None:
        row.read_at = datetime.now(UTC)
        db.commit()
    return _view(row, is_demo_actor(actor))
