"""One read adapter over existing account tables and synthetic demo records."""

from dataclasses import dataclass, field
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dependencies import DB, current_session
from app.core.errors import AppError
from app.models import (
    AccountConsentRow,
    AccountCoverageRow,
    AccountDocumentRow,
    AccountFieldRow,
    AccountProfileRow,
    PurposeConsentRow,
)
from app.repositories.session_data import insurance_row, profile_row
from app.schemas.actor import Actor
from app.schemas.consent import ConsentPurpose
from app.schemas.insurance import UnifiedInsuranceRecord
from app.schemas.profile import UserProfile
from app.services.account_access import active_account
from app.services.consents import require_purposes
from app.services.demo_access import reject_ambiguous_actor
from app.services.kb_loader import CountryKBLoader


def workspace_actor(
    db: DB,
    authorization: Annotated[str | None, Header(max_length=300)] = None,
    x_demo_session: Annotated[str | None, Header(max_length=128)] = None,
) -> Actor:
    reject_ambiguous_actor(authorization, x_demo_session)
    if authorization:
        account = active_account(db, authorization)[1]
        return Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=account.id)
    return Actor(actor_type="DEMO_SESSION", session_id=current_session(db, x_demo_session).id)


WorkspaceActor = Annotated[Actor, Depends(workspace_actor)]


def owner_filter(model, actor: Actor):
    return (
        model.account_id == actor.account_id
        if actor.account_id
        else model.session_id == actor.session_id
    )


def owner_values(actor: Actor) -> dict:
    return {"account_id": actor.account_id, "session_id": actor.session_id}


def grants(db: Session, actor: Actor) -> dict[str, bool]:
    model = AccountConsentRow if actor.account_id else PurposeConsentRow
    return {
        r.purpose: r.granted for r in db.scalars(select(model).where(owner_filter(model, actor)))
    }


def require_grants(db: Session, actor: Actor, ai: bool = False):
    purposes = (ConsentPurpose.PROCESS_DOCUMENTS,)
    if ai:
        purposes += (ConsentPurpose.EXTERNAL_AI,)
    if actor.session_id:
        require_purposes(db, actor.session_id, purposes)
    else:
        current = grants(db, actor)
        missing = [p.value for p in purposes if not current.get(p)]
        if missing:
            raise AppError(
                403,
                "CONSENT_REQUIRED",
                "Aktifkan persetujuan di Privasi & Data Saya.",
                {"required_purposes": missing},
            )


def profile(db: Session, actor: Actor) -> UserProfile:
    if actor.account_id:
        row = db.get(AccountProfileRow, actor.account_id)
        if row is None or not row.completed:
            raise AppError(409, "PROFILE_REQUIRED", "Lengkapi profil sebelum melanjutkan.")
    else:
        row = profile_row(db, actor.session_id)
    return UserProfile.model_validate(row.payload)


@dataclass
class FieldValue:
    value: object = None
    status: str = "MISSING"
    confirmed: bool = False
    document_id: UUID | None = None
    page: int | None = None
    source_type: str | None = None


@dataclass
class CoverageView:
    id: UUID
    country_code: str
    kind: str
    provider: str | None
    start: date | None
    end: date | None
    document_ids: list[UUID]
    fields: dict[str, FieldValue] = field(default_factory=dict)
    verified: bool = False
    open_ended_confirmed: bool = False
    injection_flag: bool = False
    processing_failed: bool = False
    processing_complete: bool = True

    def active(self, today: date) -> bool:
        if self.start is not None and self.start > today:
            return False
        return bool(
            (self.start and self.end and self.start <= today <= self.end)
            or (self.end is None and self.open_ended_confirmed)
        )

    def needs_check(self) -> bool:
        return not self.verified or self.injection_flag or self.processing_failed


def parsed_date(value: object) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None


def coverages(db: Session, actor: Actor, kb: CountryKBLoader) -> list[CoverageView]:
    if actor.session_id:
        record = UnifiedInsuranceRecord.model_validate(insurance_row(db, actor.session_id).payload)
        result = [
            CoverageView(
                id=p.id,
                country_code=record.country_code,
                kind=p.policy_type,
                provider=p.provider_name,
                start=p.coverage_start_date,
                end=p.coverage_end_date,
                document_ids=p.source_document_ids,
                verified=p.verification_status == "VERIFIED",
                processing_complete=bool(p.source_document_ids)
                and all(
                    any(
                        d.id == doc_id and d.processing_status == "COMPLETED"
                        for d in record.documents
                    )
                    for doc_id in p.source_document_ids
                ),
            )
            for p in record.policies
        ]
        for policy, item in zip(record.policies, result, strict=True):
            for benefit in policy.coverage_items:
                key = "benefit_" + benefit.coverage_code.lower() + "_coverage_status"
                item.fields[key] = FieldValue(benefit.coverage_status.value, "UNVERIFIED")
        return result
    fields = list(
        db.scalars(select(AccountFieldRow).where(AccountFieldRow.account_id == actor.account_id))
    )
    docs = {
        r.id: r
        for r in db.scalars(
            select(AccountDocumentRow).where(AccountDocumentRow.account_id == actor.account_id)
        )
    }
    result = []
    for row in db.scalars(
        select(AccountCoverageRow)
        .where(AccountCoverageRow.account_id == actor.account_id)
        .order_by(AccountCoverageRow.created_at, AccountCoverageRow.id)
    ):
        doc = docs.get(row.document_id)
        # A broken foreign owner association is unusable, even if present in the database.
        if row.document_id and doc is None:
            continue
        values = {}
        for f in sorted(fields, key=lambda f: f.updated_at):
            if f.coverage_id != row.id:
                continue
            if f.document_id and f.document_id not in docs:
                continue
            found = (
                f.value is not None
                and f.status == "FOUND"
                and (
                    f.confirmed_by_user
                    or (f.confidence is not None and f.confidence >= 0.8 and f.source_page)
                )
            )
            values[f.field_key] = FieldValue(
                f.value,
                "FOUND" if found else "UNVERIFIED",
                f.confirmed_by_user,
                f.document_id,
                f.source_page,
                f.source_type,
            )
        vocab = kb.load(row.country_code).resources.coverage_types.data
        explicit = values.get("coverage_type", FieldValue())
        kind = str(explicit.value) if explicit.status == "FOUND" else row.kind
        kind = next(
            (v.code for v in vocab if kind.upper() == v.code.upper() or kind in v.aliases), kind
        )
        start, end = parsed_date(row.start_date), parsed_date(row.end_date)
        valid_dates = (
            all(
                values.get(key, FieldValue()).status == "FOUND"
                and parsed_date(values[key].value) == value
                for key, value in [("coverage_start_date", start), ("coverage_end_date", end)]
            )
            and start is not None
            and end is not None
            and start <= end
        )
        membership = values.get("membership_status", FieldValue())
        open_confirmed = (
            end is None
            and membership.confirmed
            and membership.status == "FOUND"
            and str(membership.value).lower() == "active"
        )
        result.append(
            CoverageView(
                row.id,
                row.country_code,
                kind,
                row.provider,
                start,
                end,
                [row.document_id] if row.document_id else [],
                values,
                bool(valid_dates or open_confirmed),
                open_confirmed,
                bool(doc and doc.injection_flag),
                bool(doc and doc.status == "FAILED"),
                bool(doc and doc.status == "COMPLETED"),
            )
        )
    return result


def owned_coverage(items: list[CoverageView], coverage_id: UUID) -> CoverageView:
    found = next((c for c in items if c.id == coverage_id), None)
    if found is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Data tidak ditemukan pada sesi aktif.")
    return found
