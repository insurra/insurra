"""Scoped JSON export of one account's own data. Never includes bytes or page text."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AccountConsentRow,
    AccountCoverageRow,
    AccountDocumentPageRow,
    AccountDocumentRow,
    AccountFieldRow,
    AccountProfileRow,
    ClaimCaseRow,
    FamilyMemberRow,
    NotificationRow,
)
from app.schemas.actor import Actor, ActorType
from app.schemas.consent import ConsentPurpose
from app.schemas.preferences import DisplayLanguage
from app.services.preferences import current_language, current_settings, preference_row
from app.workflow.models import WfActionRow, WfClaimCaseRow
from app.workflow.owner import ACCOUNT


def _iso(value):
    return value.isoformat() if isinstance(value, datetime) else value


def _row(row, columns: tuple[str, ...]) -> dict:
    return {
        name: (str(value) if isinstance(value := getattr(row, name), UUID) else _iso(value))
        for name in columns
    }


def build_export(db: Session, account_id: UUID) -> dict:
    actor = Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=account_id)
    profile = db.get(AccountProfileRow, account_id)
    consents = list(
        db.scalars(
            select(AccountConsentRow)
            .where(AccountConsentRow.account_id == account_id)
            .order_by(AccountConsentRow.purpose)
        )
    )
    retention = any(c.purpose == ConsentPurpose.RETENTION and c.granted for c in consents)
    documents = []
    for doc in db.scalars(
        select(AccountDocumentRow)
        .where(AccountDocumentRow.account_id == account_id)
        .order_by(AccountDocumentRow.created_at, AccountDocumentRow.id)
    ):
        item = _row(
            doc,
            (
                "id",
                "kind",
                "country_code",
                "original_filename",
                "mime_type",
                "size_bytes",
                "status",
                "language",
                "injection_flag",
                "error_code",
                "created_at",
                "processed_at",
            ),
        )
        item["original_file_status"] = "RETAINED" if doc.content is not None else "DELETED"
        item["page_count"] = (
            db.scalar(select(func.count()).where(AccountDocumentPageRow.document_id == doc.id))
            if retention
            else None
        )
        documents.append(item)
    fields = [
        _row(
            f,
            (
                "id",
                "document_id",
                "coverage_id",
                "field_key",
                "value",
                "previous_value",
                "status",
                "confidence",
                "source_page",
                "source_type",
                "confirmed_by_user",
                "updated_at",
            ),
        )
        for f in db.scalars(
            select(AccountFieldRow)
            .where(AccountFieldRow.account_id == account_id)
            .order_by(AccountFieldRow.updated_at, AccountFieldRow.id)
        )
    ]
    coverages = [
        _row(
            c,
            (
                "id",
                "document_id",
                "country_code",
                "kind",
                "provider",
                "policy_number_masked",
                "start_date",
                "end_date",
                "created_at",
            ),
        )
        for c in db.scalars(
            select(AccountCoverageRow)
            .where(AccountCoverageRow.account_id == account_id)
            .order_by(AccountCoverageRow.created_at, AccountCoverageRow.id)
        )
    ]
    family = [
        _row(m, ("id", "name", "relation", "birth_date", "consent_at", "created_at"))
        for m in db.scalars(
            select(FamilyMemberRow)
            .where(FamilyMemberRow.account_id == account_id)
            .order_by(FamilyMemberRow.created_at, FamilyMemberRow.id)
        )
    ]
    claims = [
        {
            "source": "foundation",
            **_row(
                c,
                (
                    "id",
                    "country_code",
                    "path",
                    "status",
                    "claim_ref",
                    "sandbox_status",
                    "created_at",
                ),
            ),
        }
        for c in db.scalars(
            select(ClaimCaseRow)
            .where(ClaimCaseRow.account_id == account_id)
            .order_by(ClaimCaseRow.created_at, ClaimCaseRow.id)
        )
    ]
    claims += [
        {
            "source": "workflow",
            **_row(
                c,
                (
                    "id",
                    "reference",
                    "title",
                    "claim_type",
                    "country_code",
                    "status",
                    "service_date",
                    "provider_name",
                    "amount",
                    "currency",
                    "created_at",
                    "updated_at",
                ),
            ),
        }
        for c in db.scalars(
            select(WfClaimCaseRow)
            .where(WfClaimCaseRow.owner_kind == ACCOUNT, WfClaimCaseRow.owner_id == account_id)
            .order_by(WfClaimCaseRow.created_at, WfClaimCaseRow.id)
        )
    ]
    actions = [
        _row(
            a,
            (
                "id",
                "reference",
                "claim_id",
                "action_type",
                "title",
                "destination",
                "environment",
                "status",
                "payload_sha256",
                "created_at",
                "updated_at",
            ),
        )
        for a in db.scalars(
            select(WfActionRow)
            .where(WfActionRow.owner_kind == ACCOUNT, WfActionRow.owner_id == account_id)
            .order_by(WfActionRow.created_at, WfActionRow.id)
        )
    ]
    notifications = [
        _row(
            n,
            (
                "id",
                "type",
                "category",
                "priority",
                "title",
                "body",
                "deep_link",
                "created_at",
                "read_at",
            ),
        )
        for n in db.scalars(
            select(NotificationRow)
            .where(NotificationRow.account_id == account_id)
            .order_by(NotificationRow.created_at, NotificationRow.id)
        )
    ]
    prefs = preference_row(db, actor)
    return {
        "schema_version": "1",
        "generated_at": datetime.now(UTC),
        "notice": (
            "Metadata only. Original files and extracted page text are not included. "
            "Claim and action payloads are represented by their digests."
        ),
        "profile": (
            {"completed": profile.completed, **profile.payload} if profile is not None else None
        ),
        "consents": [
            _row(c, ("purpose", "granted", "policy_version", "granted_at", "revoked_at"))
            for c in consents
        ],
        "preferences": {
            **current_settings(db, actor),
            "display_language": DisplayLanguage(current_language(db, actor)).value,
            "updated_at": _iso(prefs.updated_at) if prefs else None,
        },
        "documents": documents,
        "reviewed_fields": fields,
        "coverages": coverages,
        "family_members": family,
        "claim_cases": claims,
        "actions": actions,
        "notifications": notifications,
    }
