from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.common import Contract


class NotificationCategory(StrEnum):
    ACTION_REQUIRED = "ACTION_REQUIRED"
    CLAIMS = "CLAIMS"
    PROTECTION = "PROTECTION"
    SYSTEM = "SYSTEM"


class NotificationPriority(StrEnum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"


class NotificationFilter(StrEnum):
    ALL = "all"
    UNREAD = "unread"
    ACTION_REQUIRED = "action_required"
    CLAIMS = "claims"
    PROTECTION = "protection"
    SYSTEM = "system"


class Notification(Contract):
    id: UUID
    type: str
    category: NotificationCategory
    priority: NotificationPriority
    title: str
    body: str
    entity_type: str | None = None
    entity_id: str | None = None
    deep_link: str | None = None
    created_at: datetime
    read_at: datetime | None = None
    is_read: bool
    is_demo: bool

    @field_validator("priority", mode="before")
    @classmethod
    def upper_priority(cls, value):
        return value.upper() if isinstance(value, str) else value


class NotificationPage(Contract):
    items: list[Notification]
    total: int = Field(ge=0)
    unread_count: int = Field(ge=0)
    limit: int
    offset: int


class UnreadCount(Contract):
    unread_count: int = Field(ge=0)


class NotificationsMarked(Contract):
    updated: int = Field(ge=0)
    unread_count: int = Field(ge=0)
