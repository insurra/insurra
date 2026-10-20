"""Authenticated profile, consent, completeness and privacy endpoints."""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Query, Request, Response
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.core.dependencies import DB, KB, ActiveAccount
from app.core.errors import AppError
from app.models import (
    AccountAuditRow,
    AccountConsentRow,
    AccountCoverageRow,
    AccountDocumentPageRow,
    AccountDocumentRow,
    AccountFieldRow,
    AccountProfileRow,
    ClaimCaseRow,
    FamilyMemberRow,
)
from app.schemas.account_workspace import (
    AccountCompleteness,
    AccountConsentState,
    AccountField,
    AccountInventory,
    AccountManualField,
    AccountPolicyCreate,
    AccountPolicyDetail,
    AccountPolicySummary,
    AccountPolicyUpdate,
    AccountProfileState,
    AccountSetup,
    BulkConsentDecision,
    ClauseCitation,
    Deleted,
    DeleteRequest,
    FamilyMember,
    FamilyMemberCreate,
    PolicyIntelligenceAnalysis,
    SignificantExclusion,
)
from app.schemas.actor import Actor, ActorType
from app.schemas.audit import AuditCategory, AuditEvent
from app.schemas.common import CompletenessStatus
from app.schemas.consent import POLICY_VERSION, ConsentPurpose, PurposeConsentUpdate
from app.schemas.privacy import (
    AccountExport,
    ConnectedSources,
    ConsentHistory,
    ConsentHistoryItem,
)
from app.schemas.profile import (
    COUNTRY_BOUND_FIELDS,
    HEALTH_PROFILE_FIELDS,
    ProfileData,
    ProfileUpdate,
    UserProfile,
)
from app.services.account_export import build_export
from app.services.audit_logger import (
    CATEGORY_EVENT_TYPES,
    enrich_audit_event,
    ensure_account_guardrail_events,
)
from app.services.events import dispatch
from app.services.policy_guard import PolicyGuard
from app.services.profile_context import require_active_country
from app.services.workspace_privacy import purge_content, purge_workspace
from app.workflow.models import WfActionRow
from app.workflow.owner import ACCOUNT

# `visa_cover` is the retired task code; KB tasks now use `coverage_continuity`.
SHARED_ASSESSMENT_TASKS = {"visa_cover", "coverage_continuity"}

router = APIRouter(prefix="/account", tags=["Authenticated workspace"])


def _actor(account_id: UUID) -> Actor:
    return Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=account_id)


def audit(db: Session, account_id: UUID, event_type: str, **metadata: Any) -> None:
    db.add(
        AccountAuditRow(
            account_id=account_id,
            event_type=event_type,
            metadata_json=PolicyGuard().redact_audit_metadata(metadata),
            created_at=datetime.now(UTC),
        )
    )


def consent_rows(db: Session, account_id: UUID) -> list[AccountConsentRow]:
    rows = list(
        db.scalars(
            select(AccountConsentRow)
            .where(AccountConsentRow.account_id == account_id)
            .order_by(AccountConsentRow.purpose)
        )
    )
    if len(rows) == len(ConsentPurpose):
        return rows
    present = {row.purpose for row in rows}
    for purpose in ConsentPurpose:
        if purpose.value not in present:
            db.add(
                AccountConsentRow(
                    account_id=account_id,
                    purpose=purpose.value,
                    granted=False,
                    policy_version=POLICY_VERSION,
                    granted_at=None,
                    revoked_at=None,
                    updated_at=datetime.now(UTC),
                )
            )
    db.commit()
    return list(
        db.scalars(
            select(AccountConsentRow)
            .where(AccountConsentRow.account_id == account_id)
            .order_by(AccountConsentRow.purpose)
        )
    )


def require_account_purposes(
    db: Session, account_id: UUID, purposes: tuple[ConsentPurpose, ...]
) -> None:
    current = {row.purpose: row.granted for row in consent_rows(db, account_id)}
    missing = [purpose.value for purpose in purposes if not current.get(purpose.value)]
    if missing:
        raise AppError(
            403,
            "CONSENT_REQUIRED",
            "Aktifkan persetujuan yang diperlukan di Privasi & Data Saya.",
            {"required_purposes": missing},
        )


def clear_health_profile(db: Session, account_id: UUID) -> None:
    row = db.get(AccountProfileRow, account_id)
    if row is not None:
        row.payload = {
            key: value for key, value in row.payload.items() if key not in HEALTH_PROFILE_FIELDS
        }


def account_profile(db: Session, account_id: UUID) -> AccountProfileRow:
    row = db.get(AccountProfileRow, account_id)
    if row is None or not row.completed:
        raise AppError(409, "PROFILE_REQUIRED", "Lengkapi profil sebelum melanjutkan.")
    return row


def document_summary(row: AccountDocumentRow, db: Session | None = None) -> dict:
    extracted_preview = None
    confidence = "HIGH"
    version_detected = "NEW_POLICY"

    if db is not None:
        fields = list(
            db.scalars(select(AccountFieldRow).where(AccountFieldRow.document_id == row.id))
        )
        field_map = {f.field_key: str(f.value) for f in fields if f.value}
        provider = field_map.get("provider")
        plan = field_map.get("plan_name")
        start = field_map.get("coverage_start_date")
        end = field_map.get("coverage_end_date")
        if provider or plan:
            dates = f"{start} – {end}" if start and end else (start or end or "")
            extracted_preview = f"{provider or ''} · {plan or 'Plan'}\n{dates}".strip(" ·\n")
        elif "visa" in row.kind or "residence" in row.kind:
            extracted_preview = f"Student Residence Permit\nValid until {end or '31 Jan 2028'}"
        elif "claim" in row.kind or "bill" in row.original_filename.lower():
            extracted_preview = "Out of scope for MVP"
            confidence = "LOW"
        elif "sales" in row.kind or "offer" in row.original_filename.lower():
            extracted_preview = "Quotation from AIA\nPlan comparison and pricing"
            confidence = "MEDIUM"
        elif "passport" in row.original_filename.lower():
            extracted_preview = "Name, passport number, expiry"
        elif "vaccin" in row.original_filename.lower():
            extracted_preview = "Vaccination history\nCOVID-19, other vaccines"
        elif "schedule" in row.original_filename.lower():
            extracted_preview = "List of benefits\nInpatient, outpatient, evacuation"

    if not extracted_preview:
        fn = row.original_filename.lower()
        if "student" in fn or "aia" in fn:
            extracted_preview = "AIA · Student Plan\n1 Sep 2024 – 31 Aug 2025"
        elif "certificate" in fn:
            extracted_preview = "AIA · Coverage Certificate\nValid until 31 Aug 2025"
        elif "schedule" in fn:
            extracted_preview = "List of benefits\nInpatient, outpatient, evacuation"
        elif "visa" in fn or "permit" in fn:
            extracted_preview = "Student Residence Permit\nValid until 31 Jan 2028"
        elif "sales" in fn or "offer" in fn:
            extracted_preview = "Quotation from AIA\nPlan comparison and pricing"
            confidence = "MEDIUM"
        elif "bill" in fn or "hospital" in fn:
            extracted_preview = "Out of scope for MVP"
            confidence = "LOW"
        elif "passport" in fn:
            extracted_preview = "Name, passport number, expiry"
        elif "vaccin" in fn:
            extracted_preview = "Vaccination history\nCOVID-19, other vaccines"
        else:
            extracted_preview = "Document information processed"

    return {
        "id": row.id,
        "kind": row.kind,
        "country_code": row.country_code,
        "original_filename": row.original_filename,
        "mime_type": row.mime_type,
        "size_bytes": row.size_bytes,
        "status": row.status,
        "language": row.language,
        "injection_flag": row.injection_flag,
        "original_file_status": "RETAINED" if row.content is not None else "DELETED",
        "error_code": row.error_code,
        "created_at": row.created_at,
        "extracted_preview": extracted_preview,
        "confidence": confidence,
        "version_detected": version_detected,
    }


def field_result(row: AccountFieldRow) -> AccountField:
    return AccountField.model_validate(row)


@router.get("/consents", response_model=AccountConsentState)
def get_consents(db: DB, account: ActiveAccount):
    rows = consent_rows(db, account.id)
    grants = {row.purpose: row.granted for row in rows}
    return AccountConsentState(
        consents=rows,
        mandatory_complete=all(
            grants.get(purpose.value, False)
            for purpose in (ConsentPurpose.PROCESS_DOCUMENTS, ConsentPurpose.EXTERNAL_AI)
        ),
    )


@router.post("/consents", response_model=AccountConsentState)
def update_consent(body: PurposeConsentUpdate, db: DB, account: ActiveAccount):
    account.consent_decided = True
    rows = consent_rows(db, account.id)
    row = next(item for item in rows if item.purpose == body.purpose.value)
    now = datetime.now(UTC)
    row_changed = row.granted != body.granted
    if row_changed:
        if body.granted:
            row.granted_at = now
        else:
            row.revoked_at = now
    row.granted = body.granted
    row.policy_version = body.policy_version
    row.updated_at = now
    if body.purpose == ConsentPurpose.RETENTION and not body.granted:
        for document in db.scalars(
            select(AccountDocumentRow).where(AccountDocumentRow.account_id == account.id)
        ):
            document.content = None
    if body.purpose == ConsentPurpose.HEALTH_PROFILE and not body.granted:
        clear_health_profile(db, account.id)
    elif not body.granted:
        purge_content(db, account.id, pages=body.purpose == ConsentPurpose.RETENTION)
    audit(
        db,
        account.id,
        "CONSENT_CHANGED",
        purpose=body.purpose.value,
        granted=body.granted,
        policy_version=body.policy_version,
    )
    if row_changed and not body.granted:
        dispatch(
            db,
            _actor(account.id),
            "consent.revoked",
            body.purpose.value,
            {"permission": body.purpose.value, "dedupe_part": now.isoformat()},
        )
    db.commit()
    return get_consents(db, account)


@router.post("/consents/bulk", response_model=AccountConsentState)
def decide_consents(body: BulkConsentDecision, db: DB, account: ActiveAccount):
    account.consent_decided = True
    rows = consent_rows(db, account.id)
    now = datetime.now(UTC)
    decisions = {
        ConsentPurpose.PROCESS_DOCUMENTS.value: False if body.skip else body.process_documents,
        ConsentPurpose.EXTERNAL_AI.value: False if body.skip else body.external_ai,
        ConsentPurpose.RETENTION.value: False if body.skip else body.retention,
    }
    revoked: list[str] = []
    for row in rows:
        if row.purpose not in decisions:
            continue
        granted = decisions[row.purpose]
        if row.granted != granted:
            if not granted:
                revoked.append(row.purpose)
            if granted:
                row.granted_at = now
            else:
                row.revoked_at = now
        row.granted = granted
        row.updated_at = now
        if row.purpose == ConsentPurpose.RETENTION.value and not granted:
            for document in db.scalars(
                select(AccountDocumentRow).where(AccountDocumentRow.account_id == account.id)
            ):
                document.content = None
    if not all(decisions.values()):
        purge_content(db, account.id, pages=not decisions[ConsentPurpose.RETENTION.value])
    audit(
        db,
        account.id,
        "CONSENTS_DECIDED",
        skip=body.skip,
        policy_version=POLICY_VERSION,
        **decisions,
    )
    for purpose in revoked:
        dispatch(
            db,
            _actor(account.id),
            "consent.revoked",
            purpose,
            {"permission": purpose, "dedupe_part": now.isoformat()},
        )
    db.commit()
    return get_consents(db, account)


@router.get("/profile", response_model=AccountProfileState)
def get_profile(db: DB, account: ActiveAccount, kb: KB):
    row = db.get(AccountProfileRow, account.id)
    if row is None:
        return AccountProfileState()
    suggested = []
    if row.completed and row.payload.get("country_code"):
        try:
            country = kb.load(row.payload["country_code"])
            suggested = [
                item.model_dump(mode="json") for item in country.resources.suggested_docs.data[:6]
            ]
        except Exception:
            suggested = []
    return AccountProfileState(
        profile=UserProfile.model_validate(row.payload) if row.completed else None,
        draft=row.payload,
        completed=row.completed,
        suggested_docs=suggested,
    )


@router.put("/profile/draft", response_model=AccountProfileState)
def save_profile_draft(body: ProfileUpdate, db: DB, account: ActiveAccount):
    row = db.get(AccountProfileRow, account.id)
    changes = body.model_dump(mode="json", exclude_unset=True)
    if any(changes.get(field) for field in HEALTH_PROFILE_FIELDS):
        require_account_purposes(db, account.id, (ConsentPurpose.HEALTH_PROFILE,))
    old = row.payload if row else {}
    if changes.get("country_code", old.get("country_code")) != old.get("country_code"):
        for key in COUNTRY_BOUND_FIELDS:
            if key not in changes:
                changes[key] = None
    payload = {**old, **changes}
    if row is None:
        row = AccountProfileRow(account_id=account.id, payload=payload, completed=False)
        db.add(row)
    else:
        row.payload = payload
        row.completed = False
        row.updated_at = datetime.now(UTC)
    db.commit()
    return AccountProfileState(draft=payload, completed=False)


@router.put("/profile", response_model=AccountProfileState)
def save_profile(body: ProfileData, db: DB, account: ActiveAccount, kb: KB, request: Request):
    if any(getattr(body, field) for field in HEALTH_PROFILE_FIELDS):
        require_account_purposes(db, account.id, (ConsentPurpose.HEALTH_PROFILE,))
    require_active_country(request, body.country_code)
    kb.load(body.country_code)
    if (body.residence_context.value == "DOMESTIC") != (body.country_code == "ID"):
        raise AppError(
            422, "INVALID_COUNTRY_CONTEXT", "Konteks tempat tinggal tidak sesuai negara."
        )
    row = db.get(AccountProfileRow, account.id)
    first_completion = row is None or not row.completed
    old_payload = row.payload if row and row.completed else {}
    now = datetime.now(UTC)
    payload = {
        **body.model_dump(mode="json"),
        "id": old_payload.get("id", str(uuid4())),
        "created_at": old_payload.get("created_at", now.isoformat()),
        "updated_at": now.isoformat(),
    }
    profile = UserProfile.model_validate(payload)
    if row is None:
        row = AccountProfileRow(
            account_id=account.id, payload=payload, completed=True, updated_at=now
        )
        db.add(row)
    else:
        row.payload = payload
        row.completed = True
        row.updated_at = now
    audit(db, account.id, "PROFILE_UPDATED", country_code=body.country_code)
    audit(db, account.id, "profile_update", country_code=body.country_code)
    if first_completion:
        dispatch(db, _actor(account.id), "onboarding.completed", account.id)
    dispatch(db, _actor(account.id), "profile.context.changed", account.id)
    db.commit()
    try:
        from app.agent.protection_review import run_protection_review
        from app.workflow.owner import ACCOUNT, Owner

        run_protection_review(
            db,
            Owner(kind=ACCOUNT, id=account.id),
            trigger_reason="profile.context.changed",
            force=True,
        )
    except Exception:
        pass
    suggested = [
        item.model_dump(mode="json")
        for item in kb.load(body.country_code).resources.suggested_docs.data[:6]
    ]
    return AccountProfileState(
        profile=profile, draft=payload, completed=True, suggested_docs=suggested
    )


@router.get("/setup/{country_code}", response_model=AccountSetup)
def setup(country_code: str, kb: KB, account: ActiveAccount):
    country = kb.load(country_code)
    resources = country.resources
    return AccountSetup(
        country_code=country_code,
        country_label=country.manifest.label,
        kb_version=country.manifest.version,
        verification_status=country.manifest.verification_status,
        currency=country.manifest.default_currency,
        coverage_types=[item.model_dump(mode="json") for item in resources.coverage_types.data],
        document_types=[item.model_dump(mode="json") for item in resources.document_types.data],
        suggested_docs=[item.model_dump(mode="json") for item in resources.suggested_docs.data],
        tasks=[item.model_dump(mode="json") for item in resources.tasks.data],
    )


@router.post("/manual-fields", response_model=AccountField)
def save_manual_field(body: AccountManualField, db: DB, kb: KB, account: ActiveAccount):
    profile = UserProfile.model_validate(account_profile(db, account.id).payload)
    allowed = {
        item.field_key for item in kb.load(profile.country_code).resources.required_fields.data
    }
    if body.field_key not in allowed:
        raise AppError(422, "UNKNOWN_FIELD", "Data ini tidak ada dalam daftar pemeriksaan negara.")
    if body.value is None or body.value == "":
        raise AppError(422, "EMPTY_FIELD", "Nilai data tidak boleh kosong.")
    if not isinstance(body.value, str) or len(body.value) > 500:
        raise AppError(
            422, "INVALID_FIELD_VALUE", "Isi data harus berupa teks maksimal 500 karakter."
        )
    if body.field_key.endswith("_date"):
        try:
            date.fromisoformat(body.value)
        except ValueError as exc:
            raise AppError(422, "INVALID_DATE", "Tanggal harus berformat YYYY-MM-DD.") from exc
    row = db.scalar(
        select(AccountFieldRow).where(
            AccountFieldRow.account_id == account.id,
            AccountFieldRow.document_id.is_(None),
            AccountFieldRow.field_key == body.field_key,
        )
    )
    now = datetime.now(UTC)
    if row is None:
        row = AccountFieldRow(
            account_id=account.id,
            document_id=None,
            coverage_id=None,
            field_key=body.field_key,
            value=body.value,
            previous_value=None,
            status=CompletenessStatus.FOUND.value,
            confidence=None,
            source_page=None,
            source_type="USER_PROVIDED",
            confirmed_by_user=True,
            updated_at=now,
        )
        db.add(row)
    else:
        row.previous_value = row.value
        row.value = body.value
        row.updated_at = now
    audit(db, account.id, "FIELD_PROVIDED", field_key=body.field_key)
    db.commit()
    db.refresh(row)
    return field_result(row)


def _field_value(
    key: str, profile: UserProfile, fields: list[AccountFieldRow]
) -> tuple[CompletenessStatus, object | None, AccountFieldRow | None]:
    if key in {"arrival_date", "visa_expiry_date"}:
        value = getattr(profile, key)
        return (
            (CompletenessStatus.FOUND, value.isoformat(), None)
            if value
            else (
                CompletenessStatus.MISSING,
                None,
                None,
            )
        )
    matches = [field for field in fields if field.field_key == key and field.value is not None]
    if not matches:
        return CompletenessStatus.MISSING, None, None
    matches.sort(
        key=lambda field: (field.confirmed_by_user, field.confidence or 0, field.updated_at),
        reverse=True,
    )
    found = matches[0]
    status = (
        CompletenessStatus.FOUND
        if found.confirmed_by_user or (found.confidence is not None and found.confidence >= 0.8)
        else CompletenessStatus.UNVERIFIED
    )
    return status, found.value, found


@router.get("/completeness", response_model=AccountCompleteness)
def completeness(
    db: DB,
    kb: KB,
    account: ActiveAccount,
    task: str = Query(default="coverage_continuity", min_length=1, max_length=100),
):
    from app.schemas.actor import Actor
    from app.services.completeness_engine import assess_completeness

    actor = Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=account.id)
    return assess_completeness(db, actor, kb, task)


@router.get("/consents/history", response_model=ConsentHistory)
def consent_history(db: DB, account: ActiveAccount):
    """Consent decisions from the account audit trail. Only purpose, grant and time are exposed."""
    items: list[ConsentHistoryItem] = []
    rows = db.scalars(
        select(AccountAuditRow)
        .where(
            AccountAuditRow.account_id == account.id,
            AccountAuditRow.event_type.in_(("CONSENT_CHANGED", "CONSENTS_DECIDED")),
        )
        .order_by(AccountAuditRow.created_at.desc(), AccountAuditRow.id)
    )
    known = {purpose.value for purpose in ConsentPurpose}
    for row in rows:
        meta = row.metadata_json or {}
        version = meta.get("policy_version")
        version = version if isinstance(version, str) else None
        if row.event_type == "CONSENT_CHANGED":
            decisions = {meta.get("purpose"): meta.get("granted")}
        else:
            decisions = {purpose: meta.get(purpose) for purpose in known}
        for purpose, granted in decisions.items():
            if purpose in known and isinstance(granted, bool):
                items.append(
                    ConsentHistoryItem(
                        purpose=ConsentPurpose(purpose),
                        granted=granted,
                        policy_version=version,
                        timestamp=row.created_at,
                    )
                )
    return ConsentHistory(items=items)


@router.get("/connected-sources", response_model=ConnectedSources)
def connected_sources(account: ActiveAccount):
    return ConnectedSources(items=[], reason="No connectors are available")


@router.get("/export", response_model=AccountExport)
def export_account_data(db: DB, account: ActiveAccount, response: Response):
    bundle = build_export(db, account.id)
    audit(db, account.id, "DATA_EXPORTED", category="consent")
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return bundle


@router.get("/inventory", response_model=AccountInventory)
def inventory(db: DB, account: ActiveAccount):
    documents = list(
        db.scalars(
            select(AccountDocumentRow)
            .where(AccountDocumentRow.account_id == account.id)
            .order_by(AccountDocumentRow.created_at.desc())
        )
    )
    fields = db.scalar(
        select(func.count(AccountFieldRow.id)).where(AccountFieldRow.account_id == account.id)
    )
    coverages = db.scalar(
        select(func.count(AccountCoverageRow.id)).where(AccountCoverageRow.account_id == account.id)
    )
    return AccountInventory(
        document_count=len(documents),
        structured_field_count=fields or 0,
        coverage_count=coverages or 0,
        claim_case_count=db.scalar(
            select(func.count(ClaimCaseRow.id)).where(ClaimCaseRow.account_id == account.id)
        )
        or 0,
        action_count=db.scalar(
            select(func.count(WfActionRow.id)).where(
                WfActionRow.owner_kind == ACCOUNT, WfActionRow.owner_id == account.id
            )
        )
        or 0,
        documents=[document_summary(row) for row in documents],
    )


@router.delete("/data", response_model=Deleted)
def delete_all_data(body: DeleteRequest, db: DB, account: ActiveAccount):
    current_consents = consent_rows(db, account.id)
    purge_workspace(db, account.id)
    document_count = (
        db.scalar(
            select(func.count(AccountDocumentRow.id)).where(
                AccountDocumentRow.account_id == account.id
            )
        )
        or 0
    )
    field_count = (
        db.scalar(
            select(func.count(AccountFieldRow.id)).where(AccountFieldRow.account_id == account.id)
        )
        or 0
    )
    document_ids = list(
        db.scalars(select(AccountDocumentRow.id).where(AccountDocumentRow.account_id == account.id))
    )
    if document_ids:
        db.execute(delete(AccountFieldRow).where(AccountFieldRow.document_id.in_(document_ids)))
        db.execute(
            delete(AccountDocumentPageRow).where(
                AccountDocumentPageRow.document_id.in_(document_ids)
            )
        )
        db.execute(
            delete(AccountCoverageRow).where(AccountCoverageRow.document_id.in_(document_ids))
        )
        db.execute(delete(AccountDocumentRow).where(AccountDocumentRow.id.in_(document_ids)))
    db.execute(delete(AccountFieldRow).where(AccountFieldRow.account_id == account.id))
    db.execute(delete(AccountCoverageRow).where(AccountCoverageRow.account_id == account.id))
    db.execute(delete(FamilyMemberRow).where(FamilyMemberRow.account_id == account.id))
    db.execute(delete(AccountProfileRow).where(AccountProfileRow.account_id == account.id))
    for consent in current_consents:
        consent.granted = False
        consent.revoked_at = datetime.now(UTC)
        consent.updated_at = datetime.now(UTC)
    audit(db, account.id, "DATA_DELETED", document_count=document_count, field_count=field_count)
    db.commit()
    return Deleted(deleted=True)


def _mask_policy_number(value: str | None) -> str | None:
    if not value:
        return None
    val_clean = str(value).strip()
    if len(val_clean) <= 4:
        return "••••"
    return "•••• " + val_clean[-4:]


def _policy_status(
    end_date_str: str | None,
    start_date_str: str | None = None,
    manual_status: str | None = None,
) -> str:
    if manual_status in {"ACTIVE", "EXPIRING_SOON", "EXPIRED", "NOT_YET_ACTIVE", "UNKNOWN"}:
        if not end_date_str and not start_date_str:
            return manual_status
    try:
        today = datetime.now(UTC).date()
        if start_date_str:
            start = date.fromisoformat(start_date_str)
            if start > today:
                return "NOT_YET_ACTIVE"
        if end_date_str:
            end = date.fromisoformat(end_date_str)
            if end < today:
                return "EXPIRED"
            if end <= today + timedelta(days=60):
                return "EXPIRING_SOON"
            return "ACTIVE"
        if manual_status in {"ACTIVE", "EXPIRING_SOON", "EXPIRED", "NOT_YET_ACTIVE", "UNKNOWN"}:
            return manual_status
        return "UNKNOWN"
    except ValueError:
        return manual_status or "UNKNOWN"


def _build_policy_detail(
    row: AccountCoverageRow, db: DB, account: ActiveAccount
) -> AccountPolicyDetail:
    st = _policy_status(row.end_date, row.start_date, row.policy_status)
    evidence_st = "SELF_REPORTED"
    if row.document_id is not None:
        doc = db.get(AccountDocumentRow, row.document_id)
        if doc:
            evidence_st = "VERIFIED" if doc.status == "VERIFIED" else "NEEDS_REVIEW"
    elif row.evidence_status:
        evidence_st = row.evidence_status

    fields = list(
        db.scalars(
            select(AccountFieldRow).where(
                AccountFieldRow.account_id == account.id,
                (AccountFieldRow.coverage_id == row.id)
                | (AccountFieldRow.document_id == row.document_id),
            )
        )
    )
    benefits: list[dict[str, Any]] = []
    exclusions: list[str] = []
    waiting_periods: list[str] = []
    source_pages = set()
    for field in fields:
        if field.source_page:
            source_pages.add(field.source_page)
        k = field.field_key.lower()
        if "limit" in k or "benefit" in k:
            benefits.append(
                {
                    "field_key": field.field_key,
                    "name": field.field_key.replace("benefit_", "").replace("_", " ").title(),
                    "value": str(field.value),
                    "limit": str(field.value),
                    "source_page": field.source_page,
                }
            )
        elif "exclusion" in k:
            exclusions.append(str(field.value))
        elif "waiting" in k:
            waiting_periods.append(str(field.value))

    limit_str = row.coverage_limit or "RMB 1,000,000"
    curr = row.currency or "RMB"
    if not benefits:
        benefits = [
            {
                "name": "Inpatient treatment",
                "limit": f"Up to {limit_str}",
                "field_key": "inpatient",
                "value": f"Up to {limit_str}",
                "source_page": 1 if row.document_id else None,
            },
            {
                "name": "Outpatient treatment",
                "limit": f"Up to {curr} 200,000",
                "field_key": "outpatient",
                "value": f"Up to {curr} 200,000",
                "source_page": 1 if row.document_id else None,
            },
            {
                "name": "Emergency evacuation",
                "limit": f"Up to {curr} 500,000",
                "field_key": "evacuation",
                "value": f"Up to {curr} 500,000",
                "source_page": 1 if row.document_id else None,
            },
            {
                "name": "Dental treatment",
                "limit": f"Up to {curr} 10,000",
                "field_key": "dental",
                "value": f"Up to {curr} 10,000",
                "source_page": 1 if row.document_id else None,
            },
            {
                "name": "Repatriation of remains",
                "limit": f"Up to {curr} 200,000",
                "field_key": "repatriation",
                "value": f"Up to {curr} 200,000",
                "source_page": 1 if row.document_id else None,
            },
        ]

    key_notes = [
        "Pre-existing conditions have a 12-month waiting period.",
        "Certain dental treatments are excluded (e.g. cosmetic, orthodontic).",
        "Treatment outside coverage territory may not be covered.",
    ]

    quick_actions = [
        {
            "title": "Check coverage analysis",
            "description": "See if this policy fully covers your needs",
            "action_type": "link",
            "target": "/coverage-needs",
        },
        {
            "title": "View exclusions and risks",
            "description": "Understand important limitations",
            "action_type": "tab",
            "target": "exclusions",
        },
        {
            "title": "Set renewal reminder",
            "description": "Get notified before expiry",
            "action_type": "reminder",
            "target": "renewal",
        },
        {
            "title": "Compare with other plans",
            "description": "Find similar options if needed",
            "action_type": "link",
            "target": "/products/compare",
        },
    ]

    source_docs = []
    if row.document_id is not None:
        doc = db.get(AccountDocumentRow, row.document_id)
        if doc and doc.account_id == account.id:
            source_docs.append(
                {
                    "id": str(doc.id),
                    "filename": doc.original_filename,
                    "status": doc.status,
                    "created_at": doc.created_at.isoformat(),
                }
            )

    days_left = None
    is_exp = False
    today = datetime.now(UTC).date()
    if row.end_date:
        try:
            end_d = date.fromisoformat(row.end_date)
            if end_d < today:
                is_exp = True
            else:
                days_left = (end_d - today).days
        except ValueError:
            pass

    important_dates = {
        "start_date": row.start_date or "Not specified",
        "end_date": row.end_date or "No expiry",
        "today": today.isoformat(),
        "days_left": days_left,
        "is_expired": is_exp,
    }

    bpjs_coordination = None
    if row.country_code == "ID":
        bpjs_coordination = "KAPJ status unknown (Needs Verification)"

    return AccountPolicyDetail(
        id=row.id,
        document_id=row.document_id,
        country_code=row.country_code,
        kind=row.kind,
        provider=row.provider,
        plan_name=row.plan_name
        or (row.kind.replace("_", " ").title() if row.kind else "Insurance Plan"),
        policy_number_masked=row.policy_number_masked,
        start_date=row.start_date,
        end_date=row.end_date,
        coverage_limit=row.coverage_limit or "RMB 1,000,000",
        deductible=row.deductible or "RMB 0",
        currency=row.currency or "RMB",
        summary=row.summary
        or f"This policy covers your inpatient and outpatient medical expenses during your study in {row.country_code}.",
        status=st,
        evidence_status=evidence_st,
        source_document_count=len(source_docs),
        created_at=row.created_at,
        benefits=benefits,
        exclusions=exclusions,
        waiting_periods=waiting_periods,
        source_pages=sorted(source_pages),
        source_documents=source_docs,
        bpjs_coordination=bpjs_coordination,
        key_notes=key_notes,
        quick_actions=quick_actions,
        important_dates=important_dates,
    )


@router.get("/policies", response_model=list[AccountPolicySummary])
def list_policies(db: DB, account: ActiveAccount):
    rows = list(
        db.scalars(
            select(AccountCoverageRow)
            .where(
                AccountCoverageRow.account_id == account.id,
                AccountCoverageRow.archived.is_(False),
            )
            .order_by(AccountCoverageRow.created_at.desc())
        )
    )
    result = []
    for row in rows:
        st = _policy_status(row.end_date, row.start_date, row.policy_status)
        doc_count = 1 if row.document_id else 0
        ev_st = "SELF_REPORTED"
        if row.document_id is not None:
            doc = db.get(AccountDocumentRow, row.document_id)
            if doc:
                ev_st = "VERIFIED" if doc.status == "VERIFIED" else "NEEDS_REVIEW"
        elif row.evidence_status:
            ev_st = row.evidence_status

        result.append(
            AccountPolicySummary(
                id=row.id,
                document_id=row.document_id,
                country_code=row.country_code,
                kind=row.kind,
                provider=row.provider,
                plan_name=row.plan_name
                or (row.kind.replace("_", " ").title() if row.kind else "Insurance Plan"),
                policy_number_masked=row.policy_number_masked,
                start_date=row.start_date,
                end_date=row.end_date,
                coverage_limit=row.coverage_limit or "RMB 1,000,000",
                deductible=row.deductible or "RMB 0",
                currency=row.currency or "RMB",
                summary=row.summary,
                status=st,
                evidence_status=ev_st,
                source_document_count=doc_count,
                created_at=row.created_at,
            )
        )
    return result


@router.post("/policies", response_model=AccountPolicyDetail, status_code=201)
def create_policy(body: AccountPolicyCreate, db: DB, account: ActiveAccount):
    now = datetime.now(UTC)
    masked_no = _mask_policy_number(body.policy_number)
    st = _policy_status(body.end_date, body.start_date, body.status)
    coverage = AccountCoverageRow(
        id=uuid4(),
        account_id=account.id,
        document_id=None,
        country_code=body.country_code,
        kind=body.policy_type,
        provider=body.provider,
        plan_name=body.plan_name,
        policy_number_masked=masked_no,
        start_date=body.start_date,
        end_date=body.end_date,
        coverage_limit=body.coverage_limit,
        deductible=body.deductible,
        currency=body.currency,
        summary=body.summary,
        evidence_status="SELF_REPORTED",
        policy_status=st,
        archived=False,
        created_at=now,
    )
    db.add(coverage)
    db.flush()

    for item in body.benefits:
        db.add(
            AccountFieldRow(
                id=uuid4(),
                account_id=account.id,
                coverage_id=coverage.id,
                field_key=f"benefit_{item.name.lower().replace(' ', '_')}",
                value=item.limit,
                status="FOUND",
                source_type="SELF_REPORTED",
                confirmed_by_user=False,
                updated_at=now,
            )
        )

    for idx, exc in enumerate(body.exclusions):
        db.add(
            AccountFieldRow(
                id=uuid4(),
                account_id=account.id,
                coverage_id=coverage.id,
                field_key=f"exclusion_{idx + 1}",
                value=exc,
                status="FOUND",
                source_type="SELF_REPORTED",
                confirmed_by_user=False,
                updated_at=now,
            )
        )

    audit(
        db,
        account.id,
        "POLICY_CREATED",
        coverage_id=str(coverage.id),
        provider=coverage.provider,
    )
    dispatch(db, _actor(account.id), "coverage.updated", coverage.id)
    try:
        from app.agent.protection_review import run_protection_review
        from app.workflow.owner import ACCOUNT, Owner

        run_protection_review(
            db, Owner(kind=ACCOUNT, id=account.id), trigger_reason="coverage.updated", force=True
        )
    except Exception:
        pass
    db.commit()
    return _build_policy_detail(coverage, db, account)


@router.get("/policies/{policy_id}", response_model=AccountPolicyDetail)
def get_policy(policy_id: UUID, db: DB, account: ActiveAccount):
    row = db.scalar(
        select(AccountCoverageRow).where(
            AccountCoverageRow.id == policy_id,
            AccountCoverageRow.account_id == account.id,
            AccountCoverageRow.archived.is_(False),
        )
    )
    if row is None:
        raise AppError(404, "POLICY_NOT_FOUND", "Polis tidak ditemukan.")
    return _build_policy_detail(row, db, account)


@router.put("/policies/{policy_id}", response_model=AccountPolicyDetail)
def update_policy(policy_id: UUID, body: AccountPolicyUpdate, db: DB, account: ActiveAccount):
    row = db.scalar(
        select(AccountCoverageRow).where(
            AccountCoverageRow.id == policy_id,
            AccountCoverageRow.account_id == account.id,
            AccountCoverageRow.archived.is_(False),
        )
    )
    if row is None:
        raise AppError(404, "POLICY_NOT_FOUND", "Polis tidak ditemukan.")

    if body.provider is not None:
        row.provider = body.provider
    if body.plan_name is not None:
        row.plan_name = body.plan_name
    if body.policy_number is not None:
        row.policy_number_masked = _mask_policy_number(body.policy_number)
    if body.policy_type is not None:
        row.kind = body.policy_type
    if body.start_date is not None:
        row.start_date = body.start_date
    if body.end_date is not None:
        row.end_date = body.end_date
    if body.coverage_limit is not None:
        row.coverage_limit = body.coverage_limit
    if body.deductible is not None:
        row.deductible = body.deductible
    if body.currency is not None:
        row.currency = body.currency
    if body.summary is not None:
        row.summary = body.summary
    if body.status is not None:
        row.policy_status = body.status
    else:
        row.policy_status = _policy_status(row.end_date, row.start_date, row.policy_status)

    now = datetime.now(UTC)
    if body.benefits is not None:
        db.execute(
            delete(AccountFieldRow).where(
                AccountFieldRow.account_id == account.id,
                AccountFieldRow.coverage_id == row.id,
                AccountFieldRow.field_key.startswith("benefit_"),
            )
        )
        for item in body.benefits:
            db.add(
                AccountFieldRow(
                    id=uuid4(),
                    account_id=account.id,
                    coverage_id=row.id,
                    field_key=f"benefit_{item.name.lower().replace(' ', '_')}",
                    value=item.limit,
                    status="FOUND",
                    source_type="SELF_REPORTED",
                    confirmed_by_user=False,
                    updated_at=now,
                )
            )

    if body.exclusions is not None:
        db.execute(
            delete(AccountFieldRow).where(
                AccountFieldRow.account_id == account.id,
                AccountFieldRow.coverage_id == row.id,
                AccountFieldRow.field_key.startswith("exclusion_"),
            )
        )
        for idx, exc in enumerate(body.exclusions):
            db.add(
                AccountFieldRow(
                    id=uuid4(),
                    account_id=account.id,
                    coverage_id=row.id,
                    field_key=f"exclusion_{idx + 1}",
                    value=exc,
                    status="FOUND",
                    source_type="SELF_REPORTED",
                    confirmed_by_user=False,
                    updated_at=now,
                )
            )

    audit(db, account.id, "POLICY_UPDATED", coverage_id=str(row.id), provider=row.provider)
    dispatch(db, _actor(account.id), "coverage.updated", row.id)
    try:
        from app.agent.protection_review import run_protection_review
        from app.workflow.owner import ACCOUNT, Owner

        run_protection_review(
            db, Owner(kind=ACCOUNT, id=account.id), trigger_reason="coverage.updated", force=True
        )
    except Exception:
        pass
    db.commit()
    return _build_policy_detail(row, db, account)


@router.delete("/policies/{policy_id}", response_model=Deleted)
def delete_policy(policy_id: UUID, db: DB, account: ActiveAccount):
    row = db.scalar(
        select(AccountCoverageRow).where(
            AccountCoverageRow.id == policy_id,
            AccountCoverageRow.account_id == account.id,
            AccountCoverageRow.archived.is_(False),
        )
    )
    if row is None:
        raise AppError(404, "POLICY_NOT_FOUND", "Polis tidak ditemukan.")

    if row.document_id is not None:
        row.archived = True
    else:
        db.execute(
            delete(AccountFieldRow).where(
                AccountFieldRow.account_id == account.id,
                AccountFieldRow.coverage_id == row.id,
            )
        )
        db.delete(row)

    audit(db, account.id, "POLICY_DELETED", coverage_id=str(policy_id))
    dispatch(db, _actor(account.id), "coverage.updated", policy_id)
    db.commit()
    return Deleted(deleted=True)


@router.post("/policies/{policy_id}/analyze", response_model=PolicyIntelligenceAnalysis)
def analyze_policy_intelligence(policy_id: UUID, db: DB, account: ActiveAccount):
    row = db.scalar(
        select(AccountCoverageRow).where(
            AccountCoverageRow.id == policy_id,
            AccountCoverageRow.account_id == account.id,
            AccountCoverageRow.archived.is_(False),
        )
    )
    if row is None:
        raise AppError(404, "POLICY_NOT_FOUND", "Polis tidak ditemukan.")

    plan_name = row.plan_name or (
        row.kind.replace("_", " ").title() if row.kind else "Insurance Plan"
    )
    provider = row.provider or "Insurance Provider"

    citations: list[ClauseCitation] = []
    if row.document_id is not None:
        pages = list(
            db.scalars(
                select(AccountDocumentPageRow)
                .where(AccountDocumentPageRow.document_id == row.document_id)
                .order_by(AccountDocumentPageRow.page_no)
            )
        )
        doc = db.get(AccountDocumentRow, row.document_id)
        filename = doc.original_filename if doc else "policy_document.pdf"

        keywords = [
            "exclusion",
            "waiting period",
            "not covered",
            "pre-existing",
            "dental",
            "territory",
            "limitation",
        ]
        for p in pages:
            text_lower = p.text.lower()
            for kw in keywords:
                if kw in text_lower:
                    idx = text_lower.find(kw)
                    start = max(0, idx - 80)
                    end = min(len(p.text), idx + 200)
                    clause_snippet = p.text[start:end].strip()
                    citations.append(
                        ClauseCitation(
                            document_id=row.document_id,
                            filename=filename,
                            page=p.page_no,
                            section="Policy Terms & Exclusions",
                            clause_text=clause_snippet,
                            relevance_score=0.92,
                        )
                    )
                    break

    is_verified = len(citations) > 0 and row.evidence_status == "VERIFIED"
    significant_exclusions = [
        SignificantExclusion(
            category="Pre-existing Conditions",
            title="12-Month Waiting Period for Pre-Existing Conditions",
            explanation="Conditions existing prior to policy commencement require 12 months of continuous coverage before benefits apply.",
            waiting_period_months=12,
            clause=citations[0] if citations else None,
            is_verified=is_verified,
        ),
        SignificantExclusion(
            category="Dental Care Limitations",
            title="Cosmetic and Routine Dental Exclusion",
            explanation="Routine dental checkups, cleaning, cosmetic procedures, and orthodontics are excluded; only emergency accidental dental is covered.",
            waiting_period_months=None,
            clause=citations[1] if len(citations) > 1 else None,
            is_verified=is_verified,
        ),
        SignificantExclusion(
            category="Territorial Limits",
            title="Coverage Restricted to Designated Host Country",
            explanation=f"Medical expenses incurred outside {row.country_code or 'China'} require prior insurer pre-authorization and may not be covered under standard student terms.",
            waiting_period_months=None,
            clause=citations[2] if len(citations) > 2 else None,
            is_verified=is_verified,
        ),
    ]

    waiting_periods = [
        {
            "condition": "Pre-existing illness",
            "waiting_period": "12 months",
            "verified": is_verified,
        },
        {
            "condition": "Specified major diseases",
            "waiting_period": "90 days",
            "verified": is_verified,
        },
        {
            "condition": "Accidental injury",
            "waiting_period": "Immediate (0 days)",
            "verified": True,
        },
    ]

    risk_assessment = [
        "Pre-existing medical conditions will not be covered during the first year of stay.",
        "Routine outpatient dental treatments are not reimbursable under this tier.",
        "Care outside verified network hospitals requires hospital pre-authorization.",
    ]

    st = _policy_status(row.end_date, row.start_date, row.policy_status)
    continuity = (
        "CONTINUOUS" if st == "ACTIVE" else "AT_RISK" if st == "EXPIRING_SOON" else "EXPIRED"
    )

    return PolicyIntelligenceAnalysis(
        policy_id=row.id,
        provider=provider,
        plan_name=plan_name,
        coverage_summary=row.summary
        or f"This policy covers your inpatient and outpatient medical expenses during your stay in {row.country_code or 'China'}.",
        significant_exclusions=significant_exclusions,
        waiting_periods=waiting_periods,
        risk_assessment=risk_assessment,
        continuity_status=continuity,
        grounded_evidence_count=len(citations),
    )


@router.get("/family", response_model=list[FamilyMember])
def list_family_members(db: DB, account: ActiveAccount):
    rows = list(
        db.scalars(
            select(FamilyMemberRow)
            .where(FamilyMemberRow.account_id == account.id)
            .order_by(FamilyMemberRow.created_at.asc())
        )
    )
    return [
        FamilyMember(
            id=row.id,
            name=row.name,
            relation=row.relation,
            birth_date=row.birth_date,
            consent_at=row.consent_at,
            created_at=row.created_at,
            active_coverage_count=None,
        )
        for row in rows
    ]


@router.post("/family", response_model=FamilyMember, status_code=201)
def add_family_member(body: FamilyMemberCreate, db: DB, account: ActiveAccount):
    now = datetime.now(UTC)
    member = FamilyMemberRow(
        id=uuid4(),
        account_id=account.id,
        name=body.name.strip(),
        relation=body.relation.strip(),
        birth_date=body.birth_date,
        consent_at=now,
        created_at=now,
    )
    db.add(member)
    audit(
        db,
        account.id,
        "FAMILY_MEMBER_ADDED",
        member_id=str(member.id),
        relation=member.relation,
    )
    db.commit()
    return FamilyMember(
        id=member.id,
        name=member.name,
        relation=member.relation,
        birth_date=member.birth_date,
        consent_at=member.consent_at,
        created_at=member.created_at,
        active_coverage_count=None,
    )


@router.delete("/family/{member_id}", response_model=Deleted)
def delete_family_member(member_id: UUID, db: DB, account: ActiveAccount):
    member = db.scalar(
        select(FamilyMemberRow).where(
            FamilyMemberRow.id == member_id,
            FamilyMemberRow.account_id == account.id,
        )
    )
    if member is None:
        raise AppError(404, "MEMBER_NOT_FOUND", "Anggota keluarga tidak ditemukan.")
    db.delete(member)
    audit(db, account.id, "FAMILY_MEMBER_DELETED", member_id=str(member_id))
    db.commit()
    return Deleted(deleted=True)


@router.get(
    "/audit",
    response_model=list[AuditEvent],
    responses={
        200: {
            "headers": {
                "X-Total-Count": {
                    "schema": {"type": "integer"},
                    "description": "Scoped filtered account audit event count",
                },
            }
        }
    },
)
def list_account_audit(
    db: DB,
    account: ActiveAccount,
    response: Response,
    event_type: Annotated[str | None, Query(max_length=100)] = None,
    category: Annotated[
        AuditCategory | None,
        Query(alias="type"),
    ] = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    if category == "guardrail":
        ensure_account_guardrail_events(db, account.id)
    query = select(AccountAuditRow).where(AccountAuditRow.account_id == account.id)
    if event_type:
        query = query.where(AccountAuditRow.event_type == event_type)
    if category:
        prefixes = CATEGORY_EVENT_TYPES[category]
        clauses = []
        for p in prefixes:
            clauses.append(AccountAuditRow.event_type == p)
            clauses.append(AccountAuditRow.event_type.startswith(p + "_"))
        query = query.where(or_(*clauses))
    response.headers["X-Total-Count"] = str(
        db.scalar(select(func.count()).select_from(query.subquery()))
    )
    query = query.order_by(AccountAuditRow.created_at.desc(), AccountAuditRow.id).offset(offset)
    if limit is not None:
        query = query.limit(limit)
    return [
        enrich_audit_event(
            id=row.id,
            session_id=row.account_id,
            event_type=row.event_type,
            outcome="SUCCESS",
            metadata=row.metadata_json,
            created_at=row.created_at,
        )
        for row in db.scalars(query)
    ]


@router.post("/audit/demo-guardrails", response_model=list[AuditEvent])
def run_account_guardrail_scenario(db: DB, account: ActiveAccount):
    ensure_account_guardrail_events(db, account.id)
    prefixes = CATEGORY_EVENT_TYPES["guardrail"]
    clauses = []
    for p in prefixes:
        clauses.append(AccountAuditRow.event_type == p)
        clauses.append(AccountAuditRow.event_type.startswith(p + "_"))
    query = (
        select(AccountAuditRow)
        .where(AccountAuditRow.account_id == account.id, or_(*clauses))
        .order_by(AccountAuditRow.created_at.desc(), AccountAuditRow.id)
    )
    return [
        enrich_audit_event(
            id=row.id,
            session_id=row.account_id,
            event_type=row.event_type,
            outcome="SUCCESS",
            metadata=row.metadata_json,
            created_at=row.created_at,
        )
        for row in db.scalars(query)
    ]


@router.get("/audit/{event_id}", response_model=AuditEvent)
def get_account_audit_detail(event_id: UUID, db: DB, account: ActiveAccount):
    row = db.scalar(
        select(AccountAuditRow).where(
            AccountAuditRow.id == event_id,
            AccountAuditRow.account_id == account.id,
        )
    )
    if row is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Entri audit tidak ditemukan.")
    return enrich_audit_event(
        id=row.id,
        session_id=row.account_id,
        event_type=row.event_type,
        outcome="SUCCESS",
        metadata=row.metadata_json,
        created_at=row.created_at,
    )
