"""Actor resolution for the claims workspace.

An owner is either a validated demo session or an authenticated account. The two never mix, and
no caller-supplied identifier is accepted as authentication.
"""

import hashlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError
from app.models import (
    AccountConsentRow,
    AccountCoverageRow,
    AccountDocumentRow,
    AccountProfileRow,
    DemoSessionRow,
    InsuranceRecordRow,
    ProfileRow,
    PurposeConsentRow,
)
from app.services.account_access import active_account

DEMO = "DEMO"
ACCOUNT = "ACCOUNT"
DB = Annotated[Session, Depends(get_db)]


@dataclass
class Owner:
    kind: str
    id: UUID
    display_name: str = "User"
    country_code: str | None = None
    city: str | None = None
    occupation: str | None = None
    persona_id: str | None = None
    extra: dict = field(default_factory=dict)

    @property
    def is_demo(self) -> bool:
        return self.kind == DEMO


@dataclass
class PolicyView:
    ref: str
    provider: str | None
    name: str | None
    kind: str
    number_masked: str | None
    start: str | None
    end: str | None
    country_code: str | None
    verification: str
    source_document_ids: list[str]


def _demo_owner(db: Session, token: str) -> Owner:
    row = db.scalar(
        select(DemoSessionRow).where(
            DemoSessionRow.token_hash == hashlib.sha256(token.encode()).hexdigest()
        )
    )
    if row is None or row.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC):
        raise AppError(401, "INVALID_SESSION", "Your demo session is invalid or has expired.")
    profile = db.scalar(select(ProfileRow).where(ProfileRow.session_id == row.id))
    payload = profile.payload if profile else {}
    return Owner(
        DEMO,
        row.id,
        payload.get("display_name", "Demo user"),
        payload.get("country_code"),
        payload.get("city"),
        payload.get("occupation"),
        persona_id=row.persona_id,
    )


def _account_owner(db: Session, authorization: str) -> Owner:
    _, account = active_account(db, authorization)
    profile = db.get(AccountProfileRow, account.id)
    payload = profile.payload if profile else {}
    return Owner(
        ACCOUNT,
        account.id,
        payload.get("display_name") or getattr(account, "display_name", None) or "Account",
        payload.get("country_code"),
        payload.get("city"),
        payload.get("occupation"),
    )


def current_owner(
    db: DB,
    x_demo_session: Annotated[str | None, Header(max_length=128)] = None,
    authorization: Annotated[str | None, Header(max_length=300)] = None,
) -> Owner:
    if x_demo_session and authorization:
        raise AppError(
            400, "AMBIGUOUS_ACTOR", "Send either a demo session or an account session, not both."
        )
    if authorization:
        return _account_owner(db, authorization)
    if x_demo_session:
        return _demo_owner(db, x_demo_session)
    raise AppError(401, "AUTH_REQUIRED", "Sign in or start a demo session to continue.")


def optional_owner(
    db: DB,
    x_demo_session: Annotated[str | None, Header(max_length=128)] = None,
    authorization: Annotated[str | None, Header(max_length=300)] = None,
) -> Owner | None:
    if not x_demo_session and not authorization:
        return None
    return current_owner(db, x_demo_session, authorization)


CurrentOwner = Annotated[Owner, Depends(current_owner)]
OptionalOwner = Annotated[Owner | None, Depends(optional_owner)]


def purpose_granted(db: Session, owner: Owner, purpose: str) -> bool:
    if owner.is_demo:
        row = db.scalar(
            select(PurposeConsentRow).where(
                PurposeConsentRow.session_id == owner.id, PurposeConsentRow.purpose == purpose
            )
        )
    else:
        row = db.scalar(
            select(AccountConsentRow).where(
                AccountConsentRow.account_id == owner.id, AccountConsentRow.purpose == purpose
            )
        )
    return bool(row and row.granted)


def require_purpose(db: Session, owner: Owner, purpose: str = "process_documents") -> None:
    if not purpose_granted(db, owner, purpose):
        raise AppError(
            403,
            "CONSENT_REQUIRED",
            "Document processing consent is required for this step. Grant it in Settings and Privacy.",
            {"required_purposes": [purpose]},
        )


def owner_policies(db: Session, owner: Owner) -> list[PolicyView]:
    if owner.is_demo:
        record = db.scalar(
            select(InsuranceRecordRow).where(InsuranceRecordRow.session_id == owner.id)
        )
        if record is None:
            return []
        country = record.payload.get("country_code")
        return [
            PolicyView(
                ref=str(item["id"]),
                provider=item.get("provider_name"),
                name=item.get("policy_name"),
                kind=item.get("policy_type", "OTHER"),
                number_masked=item.get("policy_number_masked"),
                start=item.get("coverage_start_date"),
                end=item.get("coverage_end_date"),
                country_code=country,
                verification=item.get("verification_status", "UNVERIFIED"),
                source_document_ids=[str(i) for i in item.get("source_document_ids", [])],
            )
            for item in record.payload.get("policies", [])
        ]
    rows = db.scalars(
        select(AccountCoverageRow)
        .where(AccountCoverageRow.account_id == owner.id)
        .order_by(AccountCoverageRow.created_at)
    )
    return [
        PolicyView(
            ref=str(row.id),
            provider=row.provider,
            name=None,
            kind=row.kind,
            number_masked=row.policy_number_masked,
            start=row.start_date,
            end=row.end_date,
            country_code=row.country_code,
            verification="UNVERIFIED",
            source_document_ids=[str(row.document_id)] if row.document_id else [],
        )
        for row in rows
    ]


def owner_policy(db: Session, owner: Owner, ref: str | None) -> PolicyView | None:
    return next((p for p in owner_policies(db, owner) if p.ref == ref), None) if ref else None


def account_documents(db: Session, owner: Owner) -> list[AccountDocumentRow]:
    if owner.is_demo:
        return []
    return list(
        db.scalars(
            select(AccountDocumentRow)
            .where(AccountDocumentRow.account_id == owner.id)
            .order_by(AccountDocumentRow.created_at.desc())
        )
    )
