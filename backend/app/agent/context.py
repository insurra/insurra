"""Canonical user context loader for the bounded insurance agent (B1.13).

Rebuilds the user's situation, consents, owned coverages with provenance, active
claims, pending actions, due reminders, and active KB metadata from owned database
rows on every call. Public catalog products are never placed in owned coverages.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import (
    AccountConsentRow,
    AccountCoverageRow,
    AccountDocumentRow,
    AccountFieldRow,
    AccountProfileRow,
    DemoSessionRow,
    InsuranceRecordRow,
    NotificationRow,
    ProfileRow,
    PurposeConsentRow,
)
from app.schemas.common import Contract as StrictModel
from app.services.actor_scope import actor_for, owner_for
from app.services.kb_loader import CountryKBLoader
from app.services.user_context import CanonicalUserContext, get_authorized_user_context
from app.workflow.models import WfActionRow, WfClaimCaseRow, WfReminderRow
from app.workflow.owner import DEMO

ProvenanceOrigin = Literal[
    "DOCUMENT_EXTRACTED",
    "USER_DECLARED",
    "USER_CONFIRMED",
    "KB_PUBLIC",
    "SYNTHETIC_FIXTURE",
    "COMPUTED",
]

VerificationStatusType = Literal[
    "VERIFIED",
    "USER_CONFIRMED",
    "NEEDS_REVIEW",
    "UNVERIFIED",
    "SYNTHETIC",
    "UNAVAILABLE",
]


class FactProvenance(StrictModel):
    origin: ProvenanceOrigin
    evidence_ref: dict[str, str | int | None] | None = None
    verification_status: VerificationStatusType = "UNVERIFIED"
    updated_at: datetime | None = None
    jurisdiction: str | None = None
    policy_version: str | None = None


class CoverageFact(StrictModel):
    id: str
    country_code: str | None = None
    kind: str
    provider: str | None = None
    name: str | None = None
    policy_number_masked: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    source_document_ids: list[str] = Field(default_factory=list)
    verification_status: VerificationStatusType = "UNVERIFIED"
    provenance: FactProvenance


class UserContext(StrictModel):
    subject_id: str = ""
    residence_city: str | None = None
    institution: str | None = None
    dependents_count: int = 0
    profile_version: int | str = 1
    verification_status: str = "SELF_REPORTED"
    actor_kind: Literal["AUTHENTICATED_ACCOUNT", "DEMO_SESSION"]
    synthetic: bool
    persona_id: str | None = None
    residence_country: str | None = None
    city: str | None = None
    nationality: str | None = None
    occupation: str | None = None
    situation: str | None = None
    institution_name: str | None = None
    employer_name: str | None = None
    study_start_date: str | None = None
    study_end_date: str | None = None
    permit_end_date: str | None = None
    timezone: str | None = None
    currency: str | None = None
    consents: dict[str, bool] = Field(default_factory=dict)
    coverages: list[CoverageFact] = Field(default_factory=list)
    open_claims_count: int = 0
    claims_needing_evidence_count: int = 0
    pending_actions_count: int = 0
    due_reminders_count: int = 0
    unread_notifications_count: int = 0
    kb_country: str | None = None
    kb_version: str | None = None
    kb_active: bool = False

    def to_canonical_context(self) -> CanonicalUserContext:
        return CanonicalUserContext(
            subject_id=self.subject_id,
            nationality=self.nationality,
            residence_country=self.residence_country,
            residence_city=self.residence_city or self.city,
            situation=self.situation,
            institution=self.institution or self.institution_name,
            dependents_count=self.dependents_count,
            profile_version=self.profile_version,
            verification_status=self.verification_status,
        )


def _load_consents(db: Session, is_demo: bool, owner_id: UUID) -> dict[str, bool]:
    base = {
        "process_documents": False,
        "external_ai": False,
        "retention": False,
        "health_profile": False,
    }
    if is_demo:
        rows = db.scalars(
            select(PurposeConsentRow).where(PurposeConsentRow.session_id == owner_id)
        ).all()
    else:
        rows = db.scalars(
            select(AccountConsentRow).where(AccountConsentRow.account_id == owner_id)
        ).all()
    for row in rows:
        base[str(row.purpose)] = bool(row.granted)
    return base


def _load_demo_coverages(db: Session, session_id: UUID) -> list[CoverageFact]:
    record = db.scalar(
        select(InsuranceRecordRow).where(InsuranceRecordRow.session_id == session_id)
    )
    if record is None or not isinstance(record.payload, dict):
        return []
    country = record.payload.get("country_code")
    facts: list[CoverageFact] = []
    for item in record.payload.get("policies", []):
        doc_ids = [str(d) for d in item.get("source_document_ids", [])]
        raw_ver = str(item.get("verification_status", "UNVERIFIED")).upper()
        ver: VerificationStatusType = (
            "VERIFIED"
            if raw_ver == "VERIFIED"
            else "NEEDS_REVIEW"
            if raw_ver == "NEEDS_REVIEW"
            else "SYNTHETIC"
        )
        facts.append(
            CoverageFact(
                id=str(item.get("id")),
                country_code=country,
                kind=str(item.get("policy_type", "OTHER")),
                provider=item.get("provider_name"),
                name=item.get("policy_name"),
                policy_number_masked=item.get("policy_number_masked"),
                start_date=item.get("coverage_start_date"),
                end_date=item.get("coverage_end_date"),
                source_document_ids=doc_ids,
                verification_status=ver,
                provenance=FactProvenance(
                    origin="SYNTHETIC_FIXTURE",
                    evidence_ref={"document_id": doc_ids[0]} if doc_ids else None,
                    verification_status=ver,
                    updated_at=getattr(record, "updated_at", None),
                    jurisdiction=country,
                ),
            )
        )
    return facts


def _load_account_coverages(db: Session, account_id: UUID) -> list[CoverageFact]:
    docs = {
        r.id: r
        for r in db.scalars(
            select(AccountDocumentRow).where(AccountDocumentRow.account_id == account_id)
        )
    }
    fields = list(
        db.scalars(select(AccountFieldRow).where(AccountFieldRow.account_id == account_id))
    )
    facts: list[CoverageFact] = []
    for row in db.scalars(
        select(AccountCoverageRow)
        .where(AccountCoverageRow.account_id == account_id)
        .order_by(AccountCoverageRow.created_at, AccountCoverageRow.id)
    ):
        if row.document_id and row.document_id not in docs:
            continue
        doc = docs.get(row.document_id)
        cov_fields = [
            f
            for f in fields
            if (f.coverage_id == row.id or (row.document_id and f.document_id == row.document_id))
        ]
        has_confirmed = any(f.confirmed_by_user and f.status == "FOUND" for f in cov_fields)
        doc_verified = doc is not None and doc.status == "VERIFIED"
        if doc_verified:
            origin = "DOCUMENT_EXTRACTED"
            ver = "VERIFIED"
        elif has_confirmed:
            origin: ProvenanceOrigin = "USER_CONFIRMED"
            ver: VerificationStatusType = "USER_CONFIRMED"
        elif bool(row.document_id or cov_fields):
            origin = "DOCUMENT_EXTRACTED"
            ver = "NEEDS_REVIEW"
        else:
            origin = "USER_DECLARED"
            ver = "UNVERIFIED"
        facts.append(
            CoverageFact(
                id=str(row.id),
                country_code=row.country_code,
                kind=row.kind,
                provider=row.provider,
                name=None,
                policy_number_masked=row.policy_number_masked,
                start_date=row.start_date,
                end_date=row.end_date,
                source_document_ids=[str(row.document_id)] if row.document_id else [],
                verification_status=ver,
                provenance=FactProvenance(
                    origin=origin,
                    evidence_ref={"document_id": str(row.document_id)} if row.document_id else None,
                    verification_status=ver,
                    updated_at=row.created_at,
                    jurisdiction=row.country_code,
                ),
            )
        )
    return facts


def get_user_context(
    db: Session,
    actor_or_owner,
    kb_loader: CountryKBLoader | None = None,
) -> UserContext:
    """Build the canonical `UserContext` for an authenticated account or demo session."""
    owner = owner_for(actor_or_owner)
    actor = actor_for(owner)
    is_demo = owner.kind == DEMO
    settings = get_settings()
    loader = kb_loader or CountryKBLoader(settings.kb_root, settings.active_kb_country_codes)

    persona_id: str | None = owner.persona_id
    payload: dict = {}
    setup: dict = {}
    if is_demo:
        demo_row = db.get(DemoSessionRow, owner.id)
        if demo_row is not None and not persona_id:
            persona_id = demo_row.persona_id
        prof_row = db.scalar(select(ProfileRow).where(ProfileRow.session_id == owner.id))
        if prof_row and isinstance(prof_row.payload, dict):
            payload = dict(prof_row.payload)
    else:
        acc_prof = db.get(AccountProfileRow, owner.id)
        if acc_prof and isinstance(acc_prof.payload, dict):
            payload = dict(acc_prof.payload)
        from app.models import AccountRow

        acc_row = db.get(AccountRow, owner.id)
        if acc_row and isinstance(getattr(acc_row, "account_setup", None), dict):
            setup = dict(acc_row.account_setup)

    country_code = payload.get("country_code") or owner.country_code
    kb_active = bool(country_code and loader.is_active(country_code.upper()))
    kb_version: str | None = None
    kb_tz: str | None = None
    kb_curr: str | None = None
    if kb_active and country_code:
        try:
            country_kb = loader.load(country_code.upper())
            kb_version = country_kb.manifest.version
            kb_tz = country_kb.manifest.default_timezone
            kb_curr = country_kb.manifest.default_currency
        except Exception:  # noqa: BLE001
            kb_active = False

    study_start = payload.get("study_start_date") or payload.get("arrival_date")
    study_end = payload.get("study_end_date")
    permit_end = payload.get("permit_end_date") or payload.get("visa_expiry_date")

    consents = _load_consents(db, is_demo, owner.id)
    coverages = (
        _load_demo_coverages(db, owner.id) if is_demo else _load_account_coverages(db, owner.id)
    )

    open_claims = (
        db.scalar(
            select(func.count())
            .select_from(WfClaimCaseRow)
            .where(
                WfClaimCaseRow.owner_kind == owner.kind,
                WfClaimCaseRow.owner_id == owner.id,
                WfClaimCaseRow.status.notin_(("APPROVED_IN_SANDBOX", "REJECTED_IN_SANDBOX")),
            )
        )
        or 0
    )
    claims_needing_evidence = (
        db.scalar(
            select(func.count())
            .select_from(WfClaimCaseRow)
            .where(
                WfClaimCaseRow.owner_kind == owner.kind,
                WfClaimCaseRow.owner_id == owner.id,
                WfClaimCaseRow.status.in_(("NEEDS_EVIDENCE", "ADDITIONAL_INFO_REQUIRED")),
            )
        )
        or 0
    )
    pending_actions = (
        db.scalar(
            select(func.count())
            .select_from(WfActionRow)
            .where(
                WfActionRow.owner_kind == owner.kind,
                WfActionRow.owner_id == owner.id,
                WfActionRow.status.in_(("AWAITING_APPROVAL", "APPROVED")),
            )
        )
        or 0
    )
    today_iso = datetime.now(UTC).date().isoformat()
    due_reminders = (
        db.scalar(
            select(func.count())
            .select_from(WfReminderRow)
            .where(
                WfReminderRow.owner_kind == owner.kind,
                WfReminderRow.owner_id == owner.id,
                WfReminderRow.status == "SCHEDULED",
                WfReminderRow.due_date <= today_iso,
            )
        )
        or 0
    )
    notif_where = (
        NotificationRow.session_id == actor.session_id
        if is_demo
        else NotificationRow.account_id == actor.account_id
    )
    unread_notifications = (
        db.scalar(
            select(func.count())
            .select_from(NotificationRow)
            .where(notif_where, NotificationRow.read_at.is_(None))
        )
        or 0
    )

    subject_id = (
        f"demo_{persona_id}"
        if (is_demo and persona_id)
        else (f"demo_{owner.id}" if is_demo else f"account_{owner.id}")
    )
    city_val = payload.get("city") or owner.city
    inst_val = payload.get("institution_name") or setup.get("institution_name")
    raw_deps = payload.get("dependents")
    deps_count = len(raw_deps) if isinstance(raw_deps, list) else 0
    raw_ver = payload.get("profile_version") or payload.get("version")
    if raw_ver is not None:
        try:
            p_ver = int(raw_ver)
        except (ValueError, TypeError):
            p_ver = str(raw_ver)
    else:
        p_ver = 4 if persona_id == "raka" else 1

    ver_status = "SELF_REPORTED"
    if not is_demo:
        has_verified_doc = db.scalar(
            select(AccountDocumentRow).where(
                AccountDocumentRow.account_id == owner.id,
                AccountDocumentRow.status == "VERIFIED",
            )
        )
        if has_verified_doc:
            ver_status = "VERIFIED"

    return UserContext(
        subject_id=subject_id,
        residence_city=city_val,
        institution=inst_val,
        dependents_count=deps_count,
        profile_version=p_ver,
        verification_status=ver_status,
        actor_kind="DEMO_SESSION" if is_demo else "AUTHENTICATED_ACCOUNT",
        synthetic=is_demo,
        persona_id=persona_id,
        residence_country=country_code,
        city=city_val,
        nationality=payload.get("nationality") or setup.get("nationality"),
        occupation=payload.get("occupation") or owner.occupation,
        situation=payload.get("residence_context") or setup.get("current_situation"),
        institution_name=inst_val,
        employer_name=payload.get("employer_name") or setup.get("employer_name"),
        study_start_date=str(study_start) if study_start else None,
        study_end_date=str(study_end) if study_end else None,
        permit_end_date=str(permit_end) if permit_end else None,
        timezone=payload.get("timezone") or setup.get("timezone") or kb_tz,
        currency=payload.get("budget_currency") or setup.get("currency") or kb_curr,
        consents=consents,
        coverages=coverages,
        open_claims_count=int(open_claims),
        claims_needing_evidence_count=int(claims_needing_evidence),
        pending_actions_count=int(pending_actions),
        due_reminders_count=int(due_reminders),
        unread_notifications_count=int(unread_notifications),
        kb_country=country_code if kb_active else None,
        kb_version=kb_version,
        kb_active=kb_active,
    )


build_user_context = get_user_context

__all__ = [
    "CanonicalUserContext",
    "CoverageFact",
    "FactProvenance",
    "UserContext",
    "build_user_context",
    "get_authorized_user_context",
    "get_user_context",
]
