"""Shared actor-header rules: one session kind per request, and revoked demo tokens are dead."""

import hashlib
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import DemoSessionRow


def reject_ambiguous_actor(authorization: str | None, demo_token: str | None) -> None:
    """A request carries an account bearer session or a demo token, never both."""
    if authorization and demo_token:
        raise AppError(422, "AMBIGUOUS_ACTOR", "Gunakan satu jenis sesi saja.")


def find_demo_session(db: Session, token: str | None) -> DemoSessionRow | None:
    """Return the live demo session for an opaque token, or None if unknown/expired/revoked."""
    if not token:
        return None
    row = db.scalar(
        select(DemoSessionRow).where(
            DemoSessionRow.token_hash == hashlib.sha256(token.encode()).hexdigest()
        )
    )
    if row is None or row.revoked_at is not None:
        return None
    if row.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC):
        return None
    return row
