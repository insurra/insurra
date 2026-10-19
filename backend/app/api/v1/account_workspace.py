"""Authenticated profile, consent, completeness and privacy endpoints."""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Query, Response
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
    FamilyMemberRow,
)
from app.schemas.account_workspace import (
    AccountCompleteness,
    AccountCompletenessItem,
    AccountConsentState,
    AccountField,
    AccountInventory,
    AccountManualField,
    AccountPolicyDetail,
    AccountPolicySummary,
    AccountProfileState,
    AccountSetup,
    AccountVisaGap,
    BulkConsentDecision,
    Deleted,
    DeleteRequest,
    FamilyMember,
    FamilyMemberCreate,
)
from app.schemas.audit import AuditCategory, AuditEvent
from app.schemas.common import CompletenessStatus
from app.schemas.consent import POLICY_VERSION, ConsentPurpose, PurposeConsentUpdate
from app.schemas.profile import ProfileData, ProfileUpdate, UserProfile
from app.services.audit_logger import (
    CATEGORY_EVENT_TYPES,
    enrich_audit_event,
    ensure_account_guardrail_events,
)
from app.services.policy_guard import PolicyGuard

router = APIRouter(prefix="/account", tags=["Authenticated workspace"])


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


def account_profile(db: Session, account_id: UUID) -> AccountProfileRow:
    row = db.get(AccountProfileRow, account_id)
    if row is None or not row.completed:
        raise AppError(409, "PROFILE_REQUIRED", "Lengkapi profil sebelum melanjutkan.")
    return row


def document_summary(row: AccountDocumentRow) -> dict:
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
    if row.granted != body.granted:
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
    audit(db, account.id, "CONSENT_CHANGED", purpose=body.purpose.value, granted=body.granted)
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
    for row in rows:
        granted = decisions.get(row.purpose, False)
        if row.granted != granted:
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
    audit(db, account.id, "CONSENTS_DECIDED", skip=body.skip, **decisions)
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
    old = row.payload if row else {}
    if changes.get("country_code", old.get("country_code")) != old.get("country_code"):
        for key in (
            "city",
            "timezone",
            "institution_name",
            "arrival_date",
            "visa_expiry_date",
            "budget_range",
            "currency",
        ):
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
def save_profile(body: ProfileData, db: DB, account: ActiveAccount, kb: KB):
    kb.load(body.country_code)
    if (body.residence_context.value == "DOMESTIC") != (body.country_code == "ID"):
        raise AppError(
            422, "INVALID_COUNTRY_CONTEXT", "Konteks tempat tinggal tidak sesuai negara."
        )
    row = db.get(AccountProfileRow, account.id)
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
    db.commit()
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
        currency="AUD" if country_code == "AU" else "IDR",
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
    task: str = Query(min_length=1, max_length=100),
):
    profile = UserProfile.model_validate(account_profile(db, account.id).payload)
    country = kb.load(profile.country_code)
    task_config = next(
        (item for item in country.resources.tasks.data if item.task_code == task), None
    )
    if task_config is None:
        raise AppError(404, "TASK_NOT_FOUND", "Tugas belum tersedia untuk negara ini.")
    required = [item for item in country.resources.required_fields.data if item.task_code == task]
    fields = list(
        db.scalars(select(AccountFieldRow).where(AccountFieldRow.account_id == account.id))
    )
    items = []
    for requirement in required:
        if not requirement.applicable:
            status, value, row = CompletenessStatus.NOT_APPLICABLE, None, None
        else:
            status, value, row = _field_value(requirement.field_key, profile, fields)
        items.append(
            AccountCompletenessItem(
                field_key=requirement.field_key,
                label=requirement.label,
                status=status,
                value=value
                if requirement.field_key not in {"policy_number", "member_number"}
                else None,
                source_type=row.source_type if row else ("USER_PROVIDED" if value else None),
                document_id=row.document_id if row else None,
                source_page=row.source_page if row else None,
                suggested_doc=requirement.suggested_doc,
            )
        )
    ready = sum(
        item.status in {CompletenessStatus.FOUND, CompletenessStatus.NOT_APPLICABLE}
        for item in items
    )
    visa_gap = None
    rule = next((item for item in country.rules if item.kind == "visa_coverage"), None)
    if rule and profile.occupation.value == "STUDENT" and task == "visa_cover":
        by_key = {item.field_key: item for item in items}
        needed = ("arrival_date", "visa_expiry_date", "coverage_start_date", "coverage_end_date")
        if not all(
            key in by_key and by_key[key].status == CompletenessStatus.FOUND for key in needed
        ):
            visa_gap = AccountVisaGap(
                status="NEEDS_VERIFICATION",
                explanation="Tanggal yang diperlukan belum lengkap atau belum terverifikasi.",
                source_url=rule.source_url,
                checked_at=rule.checked_at.isoformat() if rule.checked_at else None,
                verification_status=rule.verification_status,
            )
        else:
            arrival = date.fromisoformat(str(by_key["arrival_date"].value))
            visa_end = date.fromisoformat(str(by_key["visa_expiry_date"].value))
            cover_start = date.fromisoformat(str(by_key["coverage_start_date"].value))
            cover_end = date.fromisoformat(str(by_key["coverage_end_date"].value))
            gap = max((cover_start - arrival).days, 0) + max((visa_end - cover_end).days, 0)
            visa_gap = AccountVisaGap(
                status="GAP_FOUND" if gap else "PASS",
                gap_days=gap,
                explanation=(
                    f"Potensi jeda perlindungan {gap} hari. "
                    "Konfirmasi dengan penyedia dan sumber resmi."
                    if gap
                    else "Tanggal perlindungan mencakup interval yang diperiksa."
                ),
                source_url=rule.source_url,
                checked_at=rule.checked_at.isoformat() if rule.checked_at else None,
                verification_status=rule.verification_status,
            )
    return AccountCompleteness(
        task_code=task,
        task_label=task_config.label,
        ready_count=ready,
        total_count=len(items),
        ready_pct=round(ready * 100 / len(items)) if items else 0,
        items=items,
        visa_gap=visa_gap,
        kb_version=country.manifest.version,
        verification_status=country.resources.required_fields.verification_status,
    )


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
        claim_case_count=0,
        action_count=0,
        documents=[document_summary(row) for row in documents],
    )


@router.delete("/data", response_model=Deleted)
def delete_all_data(body: DeleteRequest, db: DB, account: ActiveAccount):
    current_consents = consent_rows(db, account.id)
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


def _policy_status(end_date_str: str | None) -> str:
    if not end_date_str:
        return "UNKNOWN"
    try:
        end = date.fromisoformat(end_date_str)
        today = datetime.now(UTC).date()
        if end < today:
            return "EXPIRED"
        if end <= today + timedelta(days=30):
            return "EXPIRING_SOON"
        return "ACTIVE"
    except ValueError:
        return "UNKNOWN"


@router.get("/policies", response_model=list[AccountPolicySummary])
def list_policies(db: DB, account: ActiveAccount):
    rows = list(
        db.scalars(
            select(AccountCoverageRow)
            .where(AccountCoverageRow.account_id == account.id)
            .order_by(AccountCoverageRow.created_at.desc())
        )
    )
    return [
        AccountPolicySummary(
            id=row.id,
            document_id=row.document_id,
            country_code=row.country_code,
            kind=row.kind,
            provider=row.provider,
            policy_number_masked=row.policy_number_masked,
            start_date=row.start_date,
            end_date=row.end_date,
            status=_policy_status(row.end_date),
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.get("/policies/{policy_id}", response_model=AccountPolicyDetail)
def get_policy(policy_id: UUID, db: DB, account: ActiveAccount):
    row = db.scalar(
        select(AccountCoverageRow).where(
            AccountCoverageRow.id == policy_id,
            AccountCoverageRow.account_id == account.id,
        )
    )
    if row is None:
        raise AppError(404, "POLICY_NOT_FOUND", "Polis tidak ditemukan.")

    fields = list(
        db.scalars(
            select(AccountFieldRow).where(
                AccountFieldRow.account_id == account.id,
                (AccountFieldRow.coverage_id == policy_id)
                | (AccountFieldRow.document_id == row.document_id),
            )
        )
    )
    benefits = []
    exclusions = []
    waiting_periods = []
    source_pages = set()
    for field in fields:
        if field.source_page:
            source_pages.add(field.source_page)
        k = field.field_key.lower()
        if "limit" in k or "benefit" in k:
            benefits.append(
                {
                    "field_key": field.field_key,
                    "value": field.value,
                    "source_page": field.source_page,
                }
            )
        elif "exclusion" in k:
            exclusions.append(str(field.value))
        elif "waiting" in k:
            waiting_periods.append(str(field.value))

    bpjs_coordination = None
    if row.country_code == "ID":
        bpjs_coordination = "KAPJ status unknown (Needs Verification)"

    return AccountPolicyDetail(
        id=row.id,
        document_id=row.document_id,
        country_code=row.country_code,
        kind=row.kind,
        provider=row.provider,
        policy_number_masked=row.policy_number_masked,
        start_date=row.start_date,
        end_date=row.end_date,
        status=_policy_status(row.end_date),
        created_at=row.created_at,
        benefits=benefits,
        exclusions=exclusions,
        waiting_periods=waiting_periods,
        source_pages=sorted(source_pages),
        bpjs_coordination=bpjs_coordination,
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
            active_coverage_count=0,
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
        active_coverage_count=0,
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
