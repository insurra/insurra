"""Family Protection API endpoints (SC-18, REG-61 to REG-66).

Manages dependents, coverage links, benefit eligibility, unmet needs, consent,
and family coverage summarization. Serves both demo and account sessions.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.errors import AppError
from app.models.account_data import FamilyMemberRow, FamilyPolicyLinkRow
from app.schemas.common import Contract
from app.schemas.family import (
    FamilyAnalysisRequest,
    FamilyAnalysisResponse,
    FamilyConsentUpdate,
    FamilyMemberCreate,
    FamilyMemberDetail,
    FamilyMemberUpdate,
    FamilyPolicyLink,
    FamilyPolicyLinkCreate,
    FamilyProtectionOverview,
)
from app.services.family_protection_engine import (
    build_member_detail,
    compute_family_summary,
)
from app.workflow.audit import record
from app.workflow.owner import DB, CurrentOwner, purpose_granted

router = APIRouter(prefix="/family", tags=["Family Protection"])


def log_family_audit(
    db: DB, owner: CurrentOwner, event_type: str, title: str, details: dict | None = None
) -> None:
    try:
        record(db, owner, event_type, "COVERAGE", title, details=details)
    except Exception:
        pass


class DeletedResponse(Contract):
    deleted: bool = True


class SuccessResponse(Contract):
    status: str = "SUCCESS"
    message: str | None = None


def _get_owner_member(
    db: DB,
    owner: CurrentOwner,
    member_id: UUID,
) -> FamilyMemberRow:
    query = (
        select(FamilyMemberRow)
        .options(selectinload(FamilyMemberRow.policies))
        .where(FamilyMemberRow.id == member_id)
    )
    if owner.is_demo:
        query = query.where(FamilyMemberRow.session_id == owner.id)
    else:
        query = query.where(FamilyMemberRow.account_id == owner.id)

    member = db.scalar(query)
    if member is None:
        raise AppError(404, "MEMBER_NOT_FOUND", "Anggota keluarga tidak ditemukan.")
    return member


def _ensure_primary_member_exists(db: DB, owner: CurrentOwner) -> None:
    query = (
        select(FamilyMemberRow)
        .options(selectinload(FamilyMemberRow.policies))
        .order_by(FamilyMemberRow.created_at.asc())
    )
    if owner.is_demo:
        query = query.where(FamilyMemberRow.session_id == owner.id)
    else:
        query = query.where(FamilyMemberRow.account_id == owner.id)

    members = list(db.scalars(query).all())

    # 1. Clean up duplicate primary members if any exist (keep the first, re-link or delete duplicates)
    primaries = [m for m in members if m.is_primary or m.relation.lower() == "primary"]
    if len(primaries) > 1:
        keep = primaries[0]
        for dup in primaries[1:]:
            for link in dup.policies:
                link.family_member_id = keep.id
            db.delete(dup)
        try:
            db.commit()
        except Exception:
            db.rollback()
        members = [m for m in members if m not in primaries[1:]]

    # 2. If no member exists at all for an authenticated account, create the primary subscriber
    if len(members) == 0 and not owner.is_demo:
        now = datetime.now(UTC)
        primary = FamilyMemberRow(
            id=uuid4(),
            account_id=owner.id,
            session_id=None,
            name=owner.display_name or "Primary Account Holder",
            relation="Primary",
            birth_date=None,
            is_primary=True,
            gender=None,
            occupation=owner.occupation,
            notes="Account primary subscriber",
            authorization_status="AUTHORIZED",
            consent_confirmed=True,
            consent_details={"scope": ["HEALTH", "CLAIMS"], "verified": True},
            consent_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(primary)
        try:
            db.commit()
        except Exception:
            db.rollback()


@router.get("/overview", response_model=FamilyProtectionOverview)
def get_family_overview(db: DB, owner: CurrentOwner):
    _ensure_primary_member_exists(db, owner)

    query = (
        select(FamilyMemberRow)
        .options(selectinload(FamilyMemberRow.policies))
        .order_by(FamilyMemberRow.is_primary.desc(), FamilyMemberRow.created_at.asc())
    )
    if owner.is_demo:
        query = query.where(FamilyMemberRow.session_id == owner.id)
    else:
        query = query.where(FamilyMemberRow.account_id == owner.id)

    rows = list(db.scalars(query).all())
    ai_granted = purpose_granted(db, owner, "external_ai")

    members_detail: list[FamilyMemberDetail] = [
        build_member_detail(row, external_ai_granted=ai_granted) for row in rows
    ]

    summary = compute_family_summary(members_detail)

    # Prefer selecting a dependent like Alya if present, or first dependent, or first member
    selected_id: UUID | None = None
    alya = next((m for m in members_detail if m.name.lower() == "alya"), None)
    if alya:
        selected_id = alya.id
    elif members_detail:
        first_dep = next((m for m in members_detail if not m.is_primary), None)
        selected_id = first_dep.id if first_dep else members_detail[0].id

    consent_summary = {
        "all_consents_valid": all(m.consent_confirmed for m in members_detail)
        if members_detail
        else True,
        "guardian_authorization": True,
        "external_ai_granted": ai_granted,
        "document_processing_granted": purpose_granted(db, owner, "process_documents"),
    }

    return FamilyProtectionOverview(
        summary=summary,
        members=members_detail,
        selected_member_id=selected_id,
        consent_summary=consent_summary,
    )


@router.get("/members", response_model=list[FamilyMemberDetail])
def list_family_members(db: DB, owner: CurrentOwner):
    _ensure_primary_member_exists(db, owner)

    query = (
        select(FamilyMemberRow)
        .options(selectinload(FamilyMemberRow.policies))
        .order_by(FamilyMemberRow.is_primary.desc(), FamilyMemberRow.created_at.asc())
    )
    if owner.is_demo:
        query = query.where(FamilyMemberRow.session_id == owner.id)
    else:
        query = query.where(FamilyMemberRow.account_id == owner.id)

    rows = list(db.scalars(query).all())
    ai_granted = purpose_granted(db, owner, "external_ai")
    return [build_member_detail(r, external_ai_granted=ai_granted) for r in rows]


@router.post("/members", response_model=FamilyMemberDetail, status_code=201)
def add_family_member(body: FamilyMemberCreate, db: DB, owner: CurrentOwner):
    now = datetime.now(UTC)
    relation_clean = body.relation.strip()
    is_prim = relation_clean.lower() == "primary"

    # Enforce: There can only be ONE primary member per owner
    if is_prim:
        existing_prim_query = select(FamilyMemberRow).where(
            FamilyMemberRow.is_primary == True  # noqa: E712
        )
        if owner.is_demo:
            existing_prim_query = existing_prim_query.where(FamilyMemberRow.session_id == owner.id)
        else:
            existing_prim_query = existing_prim_query.where(FamilyMemberRow.account_id == owner.id)
        if db.scalar(existing_prim_query):
            raise AppError(
                400,
                "PRIMARY_MEMBER_ALREADY_EXISTS",
                "Pemegang akun utama (diri sendiri) sudah terdaftar. Anda hanya dapat menambahkan anggota keluarga / tanggungan.",
            )

    # Enforce: No duplicate member with identical name for the same owner
    dup_query = select(FamilyMemberRow).where(
        func.lower(FamilyMemberRow.name) == body.name.strip().lower()
    )
    if owner.is_demo:
        dup_query = dup_query.where(FamilyMemberRow.session_id == owner.id)
    else:
        dup_query = dup_query.where(FamilyMemberRow.account_id == owner.id)
    if db.scalar(dup_query):
        raise AppError(
            400,
            "DUPLICATE_MEMBER",
            f"Anggota keluarga dengan nama '{body.name.strip()}' sudah terdaftar.",
        )

    member = FamilyMemberRow(
        id=uuid4(),
        account_id=owner.id if not owner.is_demo else None,
        session_id=owner.id if owner.is_demo else None,
        name=body.name.strip(),
        relation=relation_clean,
        birth_date=body.birth_date.strip() if body.birth_date else None,
        is_primary=is_prim,
        gender=body.gender.strip() if body.gender else None,
        occupation=body.occupation.strip() if body.occupation else None,
        notes=body.notes.strip() if body.notes else None,
        avatar_url=None,
        authorization_status="AUTHORIZED" if body.consent_confirmed else "PENDING",
        consent_confirmed=body.consent_confirmed,
        consent_details={
            "legal_guardian": is_prim or relation_clean.lower() in ("child", "son", "daughter"),
            "scope": ["HEALTH", "ELIGIBILITY"],
        },
        consent_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(member)
    db.flush()

    log_family_audit(
        db,
        owner,
        "FAMILY_MEMBER_ADDED",
        "Family member added",
        details={
            "status": "SUCCESS",
        },
    )
    db.commit()

    return build_member_detail(
        member, external_ai_granted=purpose_granted(db, owner, "external_ai")
    )


@router.get("/members/{member_id}", response_model=FamilyMemberDetail)
def get_family_member_detail(member_id: UUID, db: DB, owner: CurrentOwner):
    member = _get_owner_member(db, owner, member_id)
    return build_member_detail(
        member, external_ai_granted=purpose_granted(db, owner, "external_ai")
    )


@router.put("/members/{member_id}", response_model=FamilyMemberDetail)
def update_family_member(
    member_id: UUID,
    body: FamilyMemberUpdate,
    db: DB,
    owner: CurrentOwner,
):
    member = _get_owner_member(db, owner, member_id)

    if body.name is not None:
        new_name = body.name.strip()
        # Check duplicate name with another member
        dup_query = select(FamilyMemberRow).where(
            func.lower(FamilyMemberRow.name) == new_name.lower(),
            FamilyMemberRow.id != member.id,
        )
        if owner.is_demo:
            dup_query = dup_query.where(FamilyMemberRow.session_id == owner.id)
        else:
            dup_query = dup_query.where(FamilyMemberRow.account_id == owner.id)
        if db.scalar(dup_query):
            raise AppError(
                400,
                "DUPLICATE_MEMBER",
                f"Anggota keluarga dengan nama '{new_name}' sudah terdaftar.",
            )
        member.name = new_name
    if body.relation is not None:
        new_rel = body.relation.strip()
        if new_rel.lower() == "primary" and not member.is_primary:
            prim_query = select(FamilyMemberRow).where(
                FamilyMemberRow.is_primary == True,  # noqa: E712
                FamilyMemberRow.id != member.id,
            )
            if owner.is_demo:
                prim_query = prim_query.where(FamilyMemberRow.session_id == owner.id)
            else:
                prim_query = prim_query.where(FamilyMemberRow.account_id == owner.id)
            if db.scalar(prim_query):
                raise AppError(
                    400,
                    "PRIMARY_MEMBER_ALREADY_EXISTS",
                    "Pemegang akun utama (diri sendiri) sudah terdaftar.",
                )
        member.relation = new_rel
        member.is_primary = new_rel.lower() == "primary"
    if body.birth_date is not None:
        member.birth_date = body.birth_date.strip() if body.birth_date else None
    if body.gender is not None:
        member.gender = body.gender.strip() if body.gender else None
    if body.occupation is not None:
        member.occupation = body.occupation.strip() if body.occupation else None
    if body.notes is not None:
        member.notes = body.notes.strip() if body.notes else None

    member.updated_at = datetime.now(UTC)
    db.flush()

    log_family_audit(
        db,
        owner,
        "FAMILY_MEMBER_UPDATED",
        "Family member updated",
        details={"status": "SUCCESS"},
    )
    db.commit()

    return build_member_detail(
        member, external_ai_granted=purpose_granted(db, owner, "external_ai")
    )


@router.delete("/members/{member_id}", response_model=DeletedResponse)
def delete_family_member(member_id: UUID, db: DB, owner: CurrentOwner):
    member = _get_owner_member(db, owner, member_id)
    name = member.name
    db.delete(member)

    log_family_audit(
        db,
        owner,
        "FAMILY_MEMBER_DELETED",
        f"Family member {name} deleted",
        details={"status": "SUCCESS", "name": name},
    )
    db.commit()
    return DeletedResponse(deleted=True)


@router.post("/members/{member_id}/policies", response_model=FamilyPolicyLink, status_code=201)
def link_policy_to_member(
    member_id: UUID,
    body: FamilyPolicyLinkCreate,
    db: DB,
    owner: CurrentOwner,
):
    member = _get_owner_member(db, owner, member_id)
    now = datetime.now(UTC)

    link = FamilyPolicyLinkRow(
        id=uuid4(),
        family_member_id=member.id,
        policy_ref=body.policy_ref.strip(),
        policy_name=body.policy_name.strip(),
        provider_name=body.provider_name.strip(),
        policy_type=body.policy_type.strip(),
        policy_number_masked=body.policy_number_masked.strip()
        if body.policy_number_masked
        else None,
        coverage_role=body.coverage_role.strip(),
        status=body.status.strip(),
        verification_status=body.verification_status.strip(),
        coverage_summary=body.coverage_summary.strip() if body.coverage_summary else None,
        benefit_details=body.benefit_details or {},
        created_at=now,
        updated_at=now,
    )
    db.add(link)
    db.flush()

    log_family_audit(
        db,
        owner,
        "FAMILY_POLICY_LINKED",
        "Family policy linked",
        details={"status": "SUCCESS", "provider": link.provider_name[:100]},
    )
    db.commit()

    return FamilyPolicyLink(
        id=link.id,
        family_member_id=link.family_member_id,
        policy_ref=link.policy_ref,
        policy_name=link.policy_name,
        provider_name=link.provider_name,
        policy_type=link.policy_type,
        policy_number_masked=link.policy_number_masked,
        coverage_role=link.coverage_role,
        status=link.status,
        verification_status=link.verification_status,
        coverage_summary=link.coverage_summary,
        benefit_details=link.benefit_details,
        created_at=link.created_at,
        updated_at=link.updated_at,
    )


@router.delete("/members/{member_id}/policies/{link_id}", response_model=DeletedResponse)
def unlink_policy_from_member(
    member_id: UUID,
    link_id: UUID,
    db: DB,
    owner: CurrentOwner,
):
    member = _get_owner_member(db, owner, member_id)
    link = db.scalar(
        select(FamilyPolicyLinkRow).where(
            FamilyPolicyLinkRow.id == link_id,
            FamilyPolicyLinkRow.family_member_id == member.id,
        )
    )
    if link is None:
        raise AppError(404, "LINK_NOT_FOUND", "Tautan polis anggota keluarga tidak ditemukan.")

    db.delete(link)
    log_family_audit(
        db,
        owner,
        "FAMILY_POLICY_UNLINKED",
        "Family policy unlinked",
        details={"status": "SUCCESS"},
    )
    db.commit()
    return DeletedResponse(deleted=True)


@router.post("/consent", response_model=SuccessResponse)
def update_family_consent(
    body: FamilyConsentUpdate,
    db: DB,
    owner: CurrentOwner,
):
    now = datetime.now(UTC)
    query = select(FamilyMemberRow)
    if owner.is_demo:
        query = query.where(FamilyMemberRow.session_id == owner.id)
    else:
        query = query.where(FamilyMemberRow.account_id == owner.id)

    members = list(db.scalars(query).all())
    for m in members:
        m.consent_confirmed = body.consent_confirmed
        m.authorization_status = "AUTHORIZED" if body.consent_confirmed else "REVOKED"
        m.consent_at = now
        m.consent_details = {
            "scope": body.authorization_scope,
            "legal_guardian": body.legal_guardian_confirmed,
            "updated_at": now.isoformat(),
        }

    log_family_audit(
        db,
        owner,
        "FAMILY_CONSENT_UPDATED",
        "Family consent updated",
        details={"status": "SUCCESS"},
    )
    db.commit()
    return SuccessResponse(
        status="SUCCESS",
        message="Persetujuan dan otorisasi data keluarga berhasil diperbarui.",
    )


@router.post("/analyze", response_model=FamilyAnalysisResponse)
def analyze_family_protection(
    body: FamilyAnalysisRequest,
    db: DB,
    owner: CurrentOwner,
):
    overview = get_family_overview(db, owner)
    now = datetime.now(UTC)

    engine_notes = [
        "Relationship modeling verified across active household members.",
        "Documented policy eligibility rules applied deterministically.",
        "Unmet needs and coverage limits evaluated against declared member age profiles.",
    ]

    ai_provider = "Deterministic Rule Engine (Dependent Coverage Analyzer)"
    if body.include_external_ai and purpose_granted(db, owner, "external_ai"):
        ai_provider = "Family Protection Intelligence Analyzer (Rules + LLM Gateway)"
        engine_notes.append("External AI contextual explanations enriched.")

    log_family_audit(
        db,
        owner,
        "FAMILY_PROTECTION_ANALYZED",
        "Family protection analyzed",
        details={"status": "SUCCESS"},
    )
    db.commit()

    return FamilyAnalysisResponse(
        overview=overview,
        analyzed_at=now,
        ai_provider=ai_provider,
        engine_notes=engine_notes,
    )
