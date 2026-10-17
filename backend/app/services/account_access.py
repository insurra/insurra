"""Resolve the server-owned account session without trusting caller IDs."""

import hashlib
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import AccountRow, AccountSessionRow


def active_account(db: Session, authorization: str | None) -> tuple[AccountSessionRow, AccountRow]:
    if not authorization or not authorization.startswith("Bearer "):
        raise AppError(401, "INVALID_ACCOUNT_SESSION", "Silakan masuk untuk melanjutkan.")
    token = authorization.removeprefix("Bearer ").strip()
    if not token or len(token) > 256:
        raise AppError(401, "INVALID_ACCOUNT_SESSION", "Sesi akun tidak valid.")
    session = db.scalar(
        select(AccountSessionRow).where(
            AccountSessionRow.token_hash == hashlib.sha256(token.encode()).hexdigest()
        )
    )
    now = datetime.now(UTC)
    if (
        session is None
        or session.revoked_at is not None
        or session.expires_at.replace(tzinfo=UTC) <= now
    ):
        raise AppError(401, "INVALID_ACCOUNT_SESSION", "Sesi akun tidak valid atau kedaluwarsa.")
    account = db.get(AccountRow, session.account_id)
    if account is None:
        raise AppError(401, "INVALID_ACCOUNT_SESSION", "Sesi akun tidak valid.")
    return session, account
