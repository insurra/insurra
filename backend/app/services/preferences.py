"""Owner-scoped preferences stored in `user_preferences`.

The notification toggles and the external AI disclosure acknowledgement share the JSON column
`notification_settings` so no schema change is needed.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UserPreferenceRow
from app.services.actor_scope import owner_values, owner_where

TOGGLES = ("in_app_alerts", "reminders", "claim_updates", "renewal_alerts")
DEFAULT_SETTINGS: dict[str, bool] = {
    "in_app_alerts": True,
    "reminders": True,
    "claim_updates": True,
    "renewal_alerts": True,
    "external_ai_disclosure_acknowledged": False,
}


def preference_row(db: Session, actor) -> UserPreferenceRow | None:
    return db.scalar(select(UserPreferenceRow).where(owner_where(UserPreferenceRow, actor)))


def current_settings(db: Session, actor) -> dict[str, bool]:
    row = preference_row(db, actor)
    stored = row.notification_settings if row else {}
    return {
        key: stored[key] if isinstance(stored.get(key), bool) else default
        for key, default in DEFAULT_SETTINGS.items()
    }


def current_language(db: Session, actor) -> str:
    row = preference_row(db, actor)
    return row.display_language if row else "en"


def save_preferences(
    db: Session, actor, changes: dict[str, bool], language: str | None
) -> UserPreferenceRow:
    row = preference_row(db, actor)
    if row is None:
        row = UserPreferenceRow(
            **owner_values(actor), notification_settings={}, display_language="en"
        )
        db.add(row)
    settings = {**current_settings(db, actor), **changes}
    row.notification_settings = settings
    if language is not None:
        row.display_language = language
    row.updated_at = datetime.now(UTC)
    db.flush()
    return row
