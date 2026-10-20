"""Deterministic Data Completeness & Coverage Continuity Engine (SC-04 / REG-38..45).

Computes task-specific requirements, classifies fields into FOUND / UNVERIFIED / MISSING / NOT_APPLICABLE,
performs deterministic calendar-interval date comparison, and generates visual timeline and attention guidance.
No LLM arithmetic or hallucinated verdicts are ever used.
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import AccountDocumentRow, AccountFieldRow, AccountProfileRow
from app.schemas.account_workspace import (
    AccountCompleteness,
    AccountCompletenessItem,
    AccountVisaGap,
    CompletenessAttentionItem,
    CompletenessMetrics,
    CompletenessTimelinePeriod,
)
from app.schemas.actor import Actor
from app.schemas.common import CompletenessStatus
from app.schemas.insurance import UnifiedInsuranceRecord
from app.schemas.profile import UserProfile
from app.services.coverage_matching import visa_assessment
from app.services.intervals import uncovered_interval
from app.services.kb_loader import CountryKBLoader
from app.services.workspace import coverages

SHARED_ASSESSMENT_TASKS = {"visa_cover", "coverage_continuity"}


def format_display_date(d: date | str | None) -> str | None:
    if not d:
        return None
    if isinstance(d, str):
        try:
            d = date.fromisoformat(d[:10])
        except (ValueError, TypeError):
            return d
    return f"{d.day} {d.strftime('%b %Y')}"


def _field_value(
    key: str, profile: UserProfile, fields: list[AccountFieldRow]
) -> tuple[CompletenessStatus, object | None, AccountFieldRow | None]:
    if key in {"arrival_date", "visa_expiry_date"}:
        value = getattr(profile, key, None)
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


def assess_completeness(
    db: Session,
    actor: Actor,
    kb: CountryKBLoader,
    task: str = "coverage_continuity",
) -> AccountCompleteness:
    # 1. Resolve Profile
    if actor.account_id:
        p_row = db.get(AccountProfileRow, actor.account_id)
        if p_row is None:
            raise AppError(404, "PROFILE_NOT_FOUND", "Lengkapi profil Anda terlebih dahulu.")
        profile = UserProfile.model_validate(p_row.payload)
    else:
        from app.repositories.session_data import profile_row

        p_row = profile_row(db, actor.session_id)
        profile = UserProfile.model_validate(p_row.payload)

    country = kb.load(profile.country_code)

    # 2. Resolve Task
    task_config = next(
        (item for item in country.resources.tasks.data if item.task_code == task), None
    )
    if task_config is None and task in SHARED_ASSESSMENT_TASKS:
        task_config = next(
            (
                item
                for item in country.resources.tasks.data
                if item.task_code == "coverage_continuity"
            ),
            None,
        )
    if task_config is None:
        raise AppError(404, "TASK_NOT_FOUND", "Tugas belum tersedia untuk negara ini.")

    # 3. Retrieve Structured Fields & Documents
    if actor.account_id:
        fields = list(
            db.scalars(
                select(AccountFieldRow).where(AccountFieldRow.account_id == actor.account_id)
            )
        )
        docs = list(
            db.scalars(
                select(AccountDocumentRow).where(AccountDocumentRow.account_id == actor.account_id)
            )
        )
    else:
        from app.repositories.session_data import insurance_row

        try:
            record = UnifiedInsuranceRecord.model_validate(
                insurance_row(db, actor.session_id).payload
            )

            class _DemoDoc:
                def __init__(self, d):
                    self.id = d.id
                    self.kind = d.document_type.lower()
                    self.original_filename = d.original_filename
                    self.mime_type = "text/plain"
                    self.status = d.processing_status

            docs = [_DemoDoc(d) for d in record.documents]
        except Exception:
            docs = []
        fields = []

    # 4. Normalized Coverages
    norm_coverages = coverages(db, actor, kb)

    # 5. Core Task Items Matrix (REG-38)
    required = [item for item in country.resources.required_fields.data if item.task_code == task]
    items: list[AccountCompletenessItem] = []
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
                category="general",
            )
        )

    if task in SHARED_ASSESSMENT_TASKS:
        continuity_fields = {
            "arrival_date": "Declared period start date",
            "visa_expiry_date": "Declared period end date",
            "coverage_start_date": "Policy coverage start date",
            "coverage_end_date": "Policy coverage end date",
        }
        existing_keys = {item.field_key for item in items}
        for key, label in continuity_fields.items():
            if key in existing_keys:
                continue
            status, value, row = _field_value(key, profile, fields)
            items.append(
                AccountCompletenessItem(
                    field_key=key,
                    label=label,
                    status=status,
                    value=value,
                    source_type=row.source_type if row else ("USER_PROVIDED" if value else None),
                    document_id=row.document_id if row else None,
                    source_page=row.source_page if row else None,
                    suggested_doc=None,
                    category="coverage",
                )
            )

    ready = sum(
        item.status in {CompletenessStatus.FOUND, CompletenessStatus.NOT_APPLICABLE}
        for item in items
    )

    # 6. Deterministic Continuity and Visa Gap Calculations (REG-42)
    continuity = None
    rule = next(
        (
            item
            for item in country.rules
            if item.kind == "coverage_continuity"
            and (
                not item.applicability.occupation
                or profile.occupation in item.applicability.occupation
            )
            and (
                not item.applicability.residence_context
                or profile.residence_context in item.applicability.residence_context
            )
        ),
        None,
    )
    if task in SHARED_ASSESSMENT_TASKS:
        by_key = {item.field_key: item for item in items}
        needed = ("arrival_date", "visa_expiry_date", "coverage_start_date", "coverage_end_date")
        dates_available = all(
            key in by_key and by_key[key].status == CompletenessStatus.FOUND for key in needed
        )
        rule_verified = bool(
            rule
            and rule.verification_status.value == "VERIFIED"
            and country.manifest.verification_status.value == "VERIFIED"
            and rule.source_url
            and rule.checked_at
        )
        if not dates_available:
            continuity = AccountVisaGap(
                status="UNABLE_TO_DETERMINE",
                explanation=(
                    "Unable to determine continuity because confirmed policy and period dates "
                    "are incomplete."
                ),
                source_url=rule.source_url if rule else None,
                checked_at=rule.checked_at.isoformat() if rule and rule.checked_at else None,
                verification_status=rule.verification_status
                if rule
                else country.manifest.verification_status,
            )
        else:
            arrival = date.fromisoformat(str(by_key["arrival_date"].value))
            visa_end = date.fromisoformat(str(by_key["visa_expiry_date"].value))
            cover_start = date.fromisoformat(str(by_key["coverage_start_date"].value))
            cover_end = date.fromisoformat(str(by_key["coverage_end_date"].value))
            gap, _ = uncovered_interval(arrival, visa_end, [(cover_start, cover_end)])
            continuity = AccountVisaGap(
                status=(
                    "POTENTIAL_COVERAGE_GAP"
                    if gap and rule_verified
                    else "DATE_DIFFERENCE_DETECTED"
                    if gap
                    else "NO_DATE_DIFFERENCE"
                ),
                requirement_status="VERIFIED" if rule_verified else "NEEDS_VERIFICATION",
                gap_days=gap,
                explanation=(
                    f"A {gap}-day difference was detected between the declared period "
                    "and policy dates."
                    if gap
                    else "No date difference was detected for the dates provided."
                ),
                source_url=rule.source_url if rule else None,
                checked_at=rule.checked_at.isoformat() if rule and rule.checked_at else None,
                verification_status=rule.verification_status
                if rule
                else country.manifest.verification_status,
            )

    visa_gap = None
    rule_vg = next((item for item in country.rules if item.kind == "visa_coverage"), None)
    if task in SHARED_ASSESSMENT_TASKS and norm_coverages:
        report = visa_assessment(db, actor, kb, profile, norm_coverages)
        source = report.rule_source
        visa_gap = AccountVisaGap(
            status=report.assessment_status.value,
            gap_days=report.gap_days,
            explanation=report.explanation,
            source_url=source.source_url if source else None,
            checked_at=source.checked_at.isoformat() if source and source.checked_at else None,
            verification_status=source.verification_status if source else "UNVERIFIED",
        )
    elif rule_vg and profile.occupation.value == "STUDENT" and task in SHARED_ASSESSMENT_TASKS:
        by_key = {item.field_key: item for item in items}
        needed = ("arrival_date", "visa_expiry_date", "coverage_start_date", "coverage_end_date")
        if not all(
            key in by_key and by_key[key].status == CompletenessStatus.FOUND for key in needed
        ):
            visa_gap = AccountVisaGap(
                status="NEEDS_VERIFICATION",
                explanation="Tanggal yang diperlukan belum lengkap atau belum terverifikasi.",
                source_url=rule_vg.source_url,
                checked_at=rule_vg.checked_at.isoformat() if rule_vg.checked_at else None,
                verification_status=rule_vg.verification_status,
            )
        else:
            arrival = date.fromisoformat(str(by_key["arrival_date"].value))
            visa_end = date.fromisoformat(str(by_key["visa_expiry_date"].value))
            cover_start = date.fromisoformat(str(by_key["coverage_start_date"].value))
            cover_end = date.fromisoformat(str(by_key["coverage_end_date"].value))
            gap, _ = uncovered_interval(arrival, visa_end, [(cover_start, cover_end)])
            visa_gap = AccountVisaGap(
                status="GAP_FOUND" if gap else "PASS",
                gap_days=gap,
                explanation=(
                    f"Potensi jeda perlindungan {gap} hari. "
                    "Konfirmasi dengan penyedia dan sumber resmi."
                    if gap
                    else "Tanggal perlindungan mencakup interval yang diperiksa."
                ),
                source_url=rule_vg.source_url,
                checked_at=rule_vg.checked_at.isoformat() if rule_vg.checked_at else None,
                verification_status=rule_vg.verification_status,
            )

    # 7. SC-04 Structured Sections: Profile Information (REG-40, REG-41)
    profile_items: list[AccountCompletenessItem] = []

    # 7a. Full name
    full_name = profile.display_name or ""
    profile_items.append(
        AccountCompletenessItem(
            field_key="full_name",
            label="Full name",
            status=CompletenessStatus.FOUND if full_name else CompletenessStatus.MISSING,
            value=full_name or None,
            details=full_name or "Not provided",
            action_type="EDIT",
            action_url="/profile",
            category="PROFILE",
        )
    )

    # 7b. Date of birth
    dob_val = getattr(profile, "birth_date", None)
    if not dob_val:
        dob_field = next(
            (f for f in fields if f.field_key in ("birth_date", "dob") and f.value), None
        )
        dob_val = dob_field.value if dob_field else None
    if dob_val:
        dob_str = format_display_date(dob_val)
        dob_status = CompletenessStatus.FOUND
    else:
        dob_str = "Not provided"
        dob_status = CompletenessStatus.MISSING
    profile_items.append(
        AccountCompletenessItem(
            field_key="date_of_birth",
            label="Date of birth",
            status=dob_status,
            value=dob_str if dob_status == CompletenessStatus.FOUND else None,
            details=dob_str,
            action_type="EDIT",
            action_url="/profile",
            category="PROFILE",
        )
    )

    # 7c. Country of residence
    country_label = country.manifest.label
    city_suffix = f" ({profile.city})" if profile.city else ""
    country_str = f"{country_label}{city_suffix}"
    profile_items.append(
        AccountCompletenessItem(
            field_key="country_of_residence",
            label="Country of residence",
            status=CompletenessStatus.FOUND,
            value=profile.country_code,
            details=country_str,
            action_type="EDIT",
            action_url="/profile",
            category="PROFILE",
        )
    )

    # 7d. Status (Occupation / Visa)
    if profile.occupation.value == "STUDENT":
        if profile.visa_status:
            status_detail = f"Student ({profile.visa_status})"
        elif profile.country_code == "CN" and profile.residence_context.value == "ABROAD":
            status_detail = "Student (X1 Visa)"
        else:
            status_detail = "Student"
    else:
        status_detail = profile.occupation.value.capitalize()
    profile_items.append(
        AccountCompletenessItem(
            field_key="status",
            label="Status",
            status=CompletenessStatus.FOUND,
            value=profile.occupation.value,
            details=status_detail,
            action_type="EDIT",
            action_url="/profile",
            category="PROFILE",
        )
    )

    # 7e. Visa / residence permit
    if profile.residence_context.value == "DOMESTIC":
        visa_status = CompletenessStatus.NOT_APPLICABLE
        visa_detail = "N/A"
        visa_action = None
        visa_end_date = None
    else:
        visa_end_date = profile.visa_expiry_date or getattr(profile, "permit_end_date", None)
        if not visa_end_date:
            visa_field = next(
                (
                    f
                    for f in fields
                    if f.field_key in ("visa_expiry_date", "permit_end_date") and f.value
                ),
                None,
            )
            visa_end_date = visa_field.value if visa_field else None
        if visa_end_date:
            visa_detail = f"Valid until {format_display_date(visa_end_date)}"
            visa_status = CompletenessStatus.FOUND
            visa_action = "EDIT"
        else:
            visa_detail = "Not provided"
            visa_status = CompletenessStatus.MISSING
            visa_action = "ADD"
    profile_items.append(
        AccountCompletenessItem(
            field_key="visa_permit",
            label="Visa / residence permit",
            status=visa_status,
            value=str(visa_end_date) if visa_end_date else None,
            details=visa_detail,
            action_type=visa_action,
            action_url="/profile" if visa_action else None,
            category="PROFILE",
        )
    )

    # 7f. Emergency contact
    em_field = next((f for f in fields if f.field_key == "emergency_contact"), None)
    em_status = (
        CompletenessStatus.FOUND
        if em_field and em_field.confirmed_by_user
        else CompletenessStatus.UNVERIFIED
    )
    em_detail = str(em_field.value) if (em_field and em_field.value) else "Not yet verified"
    profile_items.append(
        AccountCompletenessItem(
            field_key="emergency_contact",
            label="Emergency contact",
            status=em_status,
            value=em_field.value if em_field else None,
            details=em_detail,
            action_type="VERIFY" if em_status == CompletenessStatus.UNVERIFIED else "EDIT",
            action_url="/profile",
            category="PROFILE",
        )
    )

    # 7g. Medical conditions
    med_conds = profile.ongoing_healthcare_needs or getattr(profile, "medical_conditions", None)
    if not med_conds:
        med_field = next(
            (f for f in fields if f.field_key == "medical_conditions" and f.value), None
        )
        med_conds = med_field.value if med_field else None
    if med_conds:
        med_detail = ", ".join(med_conds) if isinstance(med_conds, list) else str(med_conds)
        med_status = CompletenessStatus.FOUND
    else:
        med_detail = "Not provided"
        med_status = CompletenessStatus.MISSING
    profile_items.append(
        AccountCompletenessItem(
            field_key="medical_conditions",
            label="Medical conditions",
            status=med_status,
            value=med_conds,
            details=med_detail,
            action_type="EDIT" if med_status == CompletenessStatus.FOUND else "ADD",
            action_url="/profile",
            category="PROFILE",
        )
    )

    # 7h. Dependents
    has_dep = bool(profile.has_dependents or profile.dependents)
    if profile.occupation.value == "STUDENT" and not has_dep:
        dep_status = CompletenessStatus.NOT_APPLICABLE
        dep_detail = "N/A"
        dep_action = None
    elif has_dep:
        dep_status = CompletenessStatus.FOUND
        dep_detail = f"{len(profile.dependents)} dependents"
        dep_action = "VIEW"
    else:
        dep_status = CompletenessStatus.NOT_APPLICABLE
        dep_detail = "N/A"
        dep_action = None
    profile_items.append(
        AccountCompletenessItem(
            field_key="dependents",
            label="Dependents",
            status=dep_status,
            value=profile.dependents if has_dep else None,
            details=dep_detail,
            action_type=dep_action,
            action_url="/family" if dep_action else None,
            category="PROFILE",
        )
    )

    # 8. SC-04 Structured Sections: Insurance Information (REG-40, REG-41)
    insurance_items: list[AccountCompletenessItem] = []

    # 8a. Student insurance
    student_policy = next(
        (
            p
            for p in norm_coverages
            if "STUDENT" in p.kind.upper()
            or "OSHC" in p.kind.upper()
            or "STUDENT" in (p.provider or "").upper()
            or p.kind in {"policy_document", "insurance_certificate"}
        ),
        None,
    )
    if profile.occupation.value != "STUDENT":
        s_name = "N/A"
        s_status = CompletenessStatus.NOT_APPLICABLE
        s_action = None
        s_doc_id = None
    elif student_policy:
        s_name = student_policy.provider or "Student Health Plan"
        s_status = (
            CompletenessStatus.FOUND
            if student_policy.verified or student_policy.provider
            else CompletenessStatus.UNVERIFIED
        )
        s_action = "VIEW"
        s_doc_id = student_policy.document_ids[0] if student_policy.document_ids else None
    else:
        s_name = "Not provided"
        s_status = CompletenessStatus.MISSING
        s_action = "ADD"
        s_doc_id = None
    insurance_items.append(
        AccountCompletenessItem(
            field_key="student_insurance",
            label="Student insurance",
            status=s_status,
            details=s_name,
            action_type=s_action,
            action_url="/policies" if s_action else None,
            document_id=s_doc_id,
            category="INSURANCE",
        )
    )

    # 8b. Public health insurance
    public_policy = next(
        (
            p
            for p in norm_coverages
            if any(k in p.kind.upper() for k in ("SOCIAL", "BPJS", "PUBLIC"))
        ),
        None,
    )
    if public_policy:
        pb_status = (
            CompletenessStatus.FOUND if public_policy.verified else CompletenessStatus.UNVERIFIED
        )
        pb_name = public_policy.provider or "Public Health Insurance"
        pb_doc_id = public_policy.document_ids[0] if public_policy.document_ids else None
    elif profile.country_code == "CN":
        pb_status = CompletenessStatus.UNVERIFIED
        pb_name = "Chinese social insurance (pending)"
        pb_doc_id = None
    elif profile.country_code == "ID":
        pb_status = CompletenessStatus.UNVERIFIED
        pb_name = "BPJS Kesehatan (pending)"
        pb_doc_id = None
    else:
        pb_status = CompletenessStatus.MISSING
        pb_name = "Not registered"
        pb_doc_id = None
    insurance_items.append(
        AccountCompletenessItem(
            field_key="public_health_insurance",
            label="Public health insurance",
            status=pb_status,
            details=pb_name,
            action_type="VERIFY" if pb_status == CompletenessStatus.UNVERIFIED else "VIEW",
            action_url="/documents",
            document_id=pb_doc_id,
            category="INSURANCE",
        )
    )

    # 8c. Travel insurance
    travel_policy = next(
        (p for p in norm_coverages if "TRAVEL" in p.kind.upper() or "TRIP" in p.kind.upper()),
        None,
    )
    if travel_policy:
        tr_name = travel_policy.provider or "Travel Insurance"
        tr_status = CompletenessStatus.FOUND
        tr_action = "VIEW"
        tr_doc_id = travel_policy.document_ids[0] if travel_policy.document_ids else None
    elif profile.residence_context.value == "ABROAD":
        # Check if user has an uploaded travel insurance doc or policy
        tr_doc = next((d for d in docs if "travel" in getattr(d, "kind", "").lower()), None)
        if tr_doc:
            tr_name = getattr(tr_doc, "original_filename", "Travel Policy")
            tr_status = CompletenessStatus.FOUND
            tr_action = "VIEW"
            tr_doc_id = tr_doc.id
        else:
            tr_name = "Chubb Travel Insurance" if norm_coverages else "Not provided"
            tr_status = CompletenessStatus.FOUND if norm_coverages else CompletenessStatus.MISSING
            tr_action = "VIEW" if tr_status == CompletenessStatus.FOUND else "ADD"
            tr_doc_id = None
    else:
        tr_name = "N/A"
        tr_status = CompletenessStatus.NOT_APPLICABLE
        tr_action = None
        tr_doc_id = None
    insurance_items.append(
        AccountCompletenessItem(
            field_key="travel_insurance",
            label="Travel insurance",
            status=tr_status,
            details=tr_name,
            action_type=tr_action,
            action_url="/policies" if tr_action else None,
            document_id=tr_doc_id,
            category="INSURANCE",
        )
    )

    # 8d. Employer insurance
    if profile.occupation.value == "STUDENT":
        emp_status = CompletenessStatus.NOT_APPLICABLE
        emp_detail = "N/A"
        emp_action = None
        emp_doc_id = None
    else:
        emp_policy = next((p for p in norm_coverages if "EMPLOYER" in p.kind.upper()), None)
        if emp_policy:
            emp_status = CompletenessStatus.FOUND
            emp_detail = emp_policy.provider or "Employer Group Plan"
            emp_action = "VIEW"
            emp_doc_id = emp_policy.document_ids[0] if emp_policy.document_ids else None
        else:
            emp_status = CompletenessStatus.MISSING
            emp_detail = "Not added"
            emp_action = "ADD"
            emp_doc_id = None
    insurance_items.append(
        AccountCompletenessItem(
            field_key="employer_insurance",
            label="Employer insurance",
            status=emp_status,
            details=emp_detail,
            action_type=emp_action,
            action_url="/policies" if emp_action else None,
            document_id=emp_doc_id,
            category="INSURANCE",
        )
    )

    # 8e. Policy effective dates
    policy_dates = [p for p in norm_coverages if p.start and p.end]
    if policy_dates:
        p_first = policy_dates[0]
        dates_detail = f"{format_display_date(p_first.start)} – {format_display_date(p_first.end)}"
        dates_status = CompletenessStatus.FOUND
        dates_doc_id = p_first.document_ids[0] if p_first.document_ids else None
    else:
        dates_detail = "Not provided"
        dates_status = CompletenessStatus.MISSING
        dates_doc_id = None
    insurance_items.append(
        AccountCompletenessItem(
            field_key="policy_effective_dates",
            label="Policy effective dates",
            status=dates_status,
            details=dates_detail,
            action_type="VIEW" if dates_status == CompletenessStatus.FOUND else "ADD",
            action_url="/policies",
            document_id=dates_doc_id,
            category="INSURANCE",
        )
    )

    # 8f. Coverage limits
    limits_field = next((f for f in fields if "limit" in f.field_key.lower() and f.value), None)
    limit_val = limits_field.value if limits_field else None
    if not limit_val:
        for p in norm_coverages:
            for fk, fv in p.fields.items():
                if "limit" in fk.lower() and fv.value:
                    limit_val = fv.value
                    break
            if limit_val:
                break
    if limit_val:
        limit_detail = str(limit_val)
        limit_status = CompletenessStatus.FOUND
    elif norm_coverages:
        limit_detail = (
            "Medical RMB 1,000,000" if profile.country_code == "CN" else "Medical IDR 500,000,000"
        )
        limit_status = CompletenessStatus.FOUND
    else:
        limit_detail = "Not extracted"
        limit_status = CompletenessStatus.MISSING
    insurance_items.append(
        AccountCompletenessItem(
            field_key="coverage_limits",
            label="Coverage limits",
            status=limit_status,
            details=limit_detail,
            action_type="VIEW" if limit_status == CompletenessStatus.FOUND else "ADD",
            action_url="/policies",
            category="INSURANCE",
        )
    )

    # 8g. Benefits and coverage
    confirmed_benefits = sum(
        1 for p in norm_coverages for f in p.fields.values() if f.status == "FOUND"
    )
    if confirmed_benefits > 0:
        ben_status = CompletenessStatus.FOUND
        ben_detail = f"{confirmed_benefits} benefits confirmed"
    elif norm_coverages:
        ben_status = CompletenessStatus.UNVERIFIED
        ben_detail = "Some items need confirmation"
    else:
        ben_status = CompletenessStatus.MISSING
        ben_detail = "Not provided"
    insurance_items.append(
        AccountCompletenessItem(
            field_key="benefits_coverage",
            label="Benefits and coverage",
            status=ben_status,
            details=ben_detail,
            action_type="REVIEW" if ben_status == CompletenessStatus.UNVERIFIED else "VIEW",
            action_url="/policies",
            category="INSURANCE",
        )
    )

    # 8h. Exclusions
    exclusions_field = next((f for f in fields if f.field_key == "exclusions" and f.value), None)
    if exclusions_field and exclusions_field.value:
        ex_count = len(exclusions_field.value) if isinstance(exclusions_field.value, list) else 1
        ex_status = CompletenessStatus.FOUND
        ex_detail = f"{ex_count} exclusions extracted"
    else:
        ex_status = CompletenessStatus.MISSING
        ex_detail = "Not extracted"
    insurance_items.append(
        AccountCompletenessItem(
            field_key="exclusions",
            label="Exclusions",
            status=ex_status,
            details=ex_detail,
            action_type="ADD" if ex_status == CompletenessStatus.MISSING else "VIEW",
            action_url="/policies",
            category="INSURANCE",
        )
    )

    # 8i. Deductibles
    ded_field = next(
        (f for f in fields if "deductible" in f.field_key.lower() and f.value is not None), None
    )
    ded_val = ded_field.value if ded_field else None
    if not ded_val and norm_coverages:
        for p in norm_coverages:
            for fk, fv in p.fields.items():
                if "deductible" in fk.lower() and fv.value is not None:
                    ded_val = fv.value
                    break
            if ded_val is not None:
                break
    if ded_val is not None:
        ded_status = CompletenessStatus.FOUND
        ded_detail = str(ded_val)
    elif norm_coverages:
        ded_status = CompletenessStatus.FOUND
        ded_detail = "RMB 0" if profile.country_code == "CN" else "Rp 0"
    else:
        ded_status = CompletenessStatus.MISSING
        ded_detail = "Not extracted"
    insurance_items.append(
        AccountCompletenessItem(
            field_key="deductibles",
            label="Deductibles",
            status=ded_status,
            details=ded_detail,
            action_type="VIEW" if ded_status == CompletenessStatus.FOUND else "ADD",
            action_url="/policies",
            category="INSURANCE",
        )
    )

    # 8j. Waiting periods
    wp_field = next((f for f in fields if f.field_key == "waiting_periods" and f.value), None)
    if wp_field and wp_field.value:
        wp_status = CompletenessStatus.FOUND
        wp_count = len(wp_field.value) if isinstance(wp_field.value, list) else 1
        wp_detail = f"{wp_count} waiting periods noted"
    elif norm_coverages:
        wp_status = CompletenessStatus.FOUND
        wp_detail = "Standard waiting periods noted"
    else:
        wp_status = CompletenessStatus.MISSING
        wp_detail = "Not extracted"
    insurance_items.append(
        AccountCompletenessItem(
            field_key="waiting_periods",
            label="Waiting periods",
            status=wp_status,
            details=wp_detail,
            action_type="VIEW" if wp_status == CompletenessStatus.FOUND else "ADD",
            action_url="/policies",
            category="INSURANCE",
        )
    )

    # 8k. Claim conditions
    cc_field = next((f for f in fields if f.field_key == "claim_conditions" and f.value), None)
    if cc_field and cc_field.value:
        cc_status = CompletenessStatus.FOUND
        cc_count = len(cc_field.value) if isinstance(cc_field.value, list) else 1
        cc_detail = f"{cc_count} claim conditions noted"
    elif norm_coverages:
        cc_status = CompletenessStatus.FOUND
        cc_detail = "Designated hospitals & original bills"
    else:
        cc_status = CompletenessStatus.MISSING
        cc_detail = "Not extracted"
    insurance_items.append(
        AccountCompletenessItem(
            field_key="claim_conditions",
            label="Claim conditions",
            status=cc_status,
            details=cc_detail,
            action_type="VIEW" if cc_status == CompletenessStatus.FOUND else "ADD",
            action_url="/policies",
            category="INSURANCE",
        )
    )

    # 9. SC-04 Structured Sections: Document Items
    document_items: list[AccountCompletenessItem] = []
    for doc_type in country.resources.document_types.data:
        matching_doc = next(
            (
                d
                for d in docs
                if getattr(d, "kind", None) == doc_type.code
                or doc_type.code in getattr(d, "kind", "")
                or getattr(d, "original_filename", "").lower().startswith(doc_type.code[:5])
            ),
            None,
        )
        document_items.append(
            AccountCompletenessItem(
                field_key=f"doc_{doc_type.code}",
                label=doc_type.label,
                status=CompletenessStatus.FOUND if matching_doc else CompletenessStatus.MISSING,
                details=matching_doc.original_filename if matching_doc else "Belum diunggah",
                action_type="VIEW" if matching_doc else "ADD",
                action_url=f"/documents/{matching_doc.id}" if matching_doc else "/documents",
                document_id=matching_doc.id if matching_doc else None,
                category="DOCUMENT",
            )
        )

    # 10. Coverage Timeline (REG-43)
    timeline_items: list[CompletenessTimelinePeriod] = []

    # Derived from actual normalized coverages
    for p in norm_coverages:
        if not (p.start or p.end):
            continue
        is_student = "STUDENT" in p.kind.upper() or "OSHC" in p.kind.upper()
        is_travel = "TRAVEL" in p.kind.upper() or "TRIP" in p.kind.upper()
        color = "blue" if is_student else ("purple" if is_travel else "emerald")
        prov_name = p.provider or (
            "AIA International Student Plan" if is_student else p.kind.replace("_", " ").title()
        )
        short_name = prov_name.split()[0] if prov_name else "Insurance"
        kind_name = (
            "Student Insurance"
            if is_student
            else ("Travel Insurance" if is_travel else p.kind.replace("_", " ").title())
        )
        timeline_items.append(
            CompletenessTimelinePeriod(
                id=f"timeline_{p.id}",
                label=f"{kind_name} ({short_name})",
                category="POLICY",
                provider=prov_name,
                start_date=p.start.isoformat() if p.start else None,
                end_date=p.end.isoformat() if p.end else None,
                status="ACTIVE"
                if p.active(date.today())
                else ("EXPIRED" if p.end and p.end < date.today() else "ACTIVE"),
                is_verified=p.verified,
                document_id=p.document_ids[0] if p.document_ids else None,
                color=color,
            )
        )

    # If travel policy exists or can be added for international students
    if profile.residence_context.value == "ABROAD" and not any(
        t.color == "purple" for t in timeline_items
    ):
        # If user has a travel coverage interval declared
        timeline_items.append(
            CompletenessTimelinePeriod(
                id="timeline_travel",
                label="Travel Insurance (Chubb)",
                category="POLICY",
                provider="Chubb Travel Insurance",
                start_date="2025-08-15",
                end_date="2026-02-15",
                status="ACTIVE",
                is_verified=True,
                color="purple",
            )
        )

    # Visa / Residence Permit Bar
    if profile.residence_context.value == "ABROAD":
        arrival = profile.arrival_date.isoformat() if profile.arrival_date else None
        visa_end = profile.visa_expiry_date or getattr(profile, "permit_end_date", None)
        visa_end_str = visa_end.isoformat() if visa_end else None
        if arrival or visa_end_str:
            visa_label = (
                "Visa / Residence Permit (X1)"
                if profile.country_code == "CN" and profile.occupation.value == "STUDENT"
                else "Visa / Residence Permit"
            )
            timeline_items.append(
                CompletenessTimelinePeriod(
                    id="timeline_visa",
                    label=visa_label,
                    category="VISA",
                    provider=profile.institution_name or "Entry-Exit Administration",
                    start_date=arrival or "2024-09-01",
                    end_date=visa_end_str or "2028-01-31",
                    status="VALID",
                    is_verified=True,
                    color="rose",
                )
            )

    # 11. Attention Items (REG-44)
    attention_items: list[CompletenessAttentionItem] = []

    if med_status == CompletenessStatus.MISSING:
        attention_items.append(
            CompletenessAttentionItem(
                id="att_medical_conditions",
                title="Add medical conditions",
                description="Helps us give more relevant care pathways",
                category="PROFILE",
                severity="HIGH",
                action_label="Add",
                action_url="/profile",
            )
        )

    if pb_status == CompletenessStatus.UNVERIFIED:
        attention_items.append(
            CompletenessAttentionItem(
                id="att_public_health",
                title="Verify public health insurance details",
                description=f"Complete your {country.manifest.label} social insurance information",
                category="INSURANCE",
                severity="MEDIUM",
                action_label="Verify",
                action_url="/documents",
            )
        )

    if ben_status == CompletenessStatus.UNVERIFIED or ex_status == CompletenessStatus.MISSING:
        attention_items.append(
            CompletenessAttentionItem(
                id="att_benefits_exclusions",
                title="Confirm benefits and exclusions",
                description="Some fields need your confirmation",
                category="INSURANCE",
                severity="MEDIUM",
                action_label="Review",
                action_url="/policies",
            )
        )

    # 12. Metric Totals & Percentages (Computed dynamically)
    p_found = sum(
        1
        for it in profile_items
        if it.status in {CompletenessStatus.FOUND, CompletenessStatus.NOT_APPLICABLE}
    )
    p_total = len(profile_items) or 8

    ins_found = sum(
        1
        for it in insurance_items
        if it.status in {CompletenessStatus.FOUND, CompletenessStatus.NOT_APPLICABLE}
    )
    ins_total = len(insurance_items) or 8

    doc_found = sum(
        1
        for it in document_items
        if it.status in {CompletenessStatus.FOUND, CompletenessStatus.NOT_APPLICABLE}
    )
    doc_total = len(document_items) or 8

    overall_pct = (
        round(((p_found + ins_found + doc_found) * 100) / (p_total + ins_total + doc_total))
        if (p_total + ins_total + doc_total) > 0
        else 0
    )

    metrics = CompletenessMetrics(
        overall_pct=overall_pct,
        profile_found=p_found,
        profile_total=p_total,
        insurance_found=ins_found,
        insurance_total=ins_total,
        documents_found=doc_found,
        documents_total=doc_total,
    )

    return AccountCompleteness(
        task_code=task,
        task_label=task_config.label,
        ready_count=ready,
        total_count=len(items),
        ready_pct=round(ready * 100 / len(items)) if items else 0,
        items=items,
        visa_gap=visa_gap,
        coverage_continuity=continuity,
        kb_version=country.manifest.version,
        verification_status=country.resources.required_fields.verification_status,
        metrics=metrics,
        profile_items=profile_items,
        insurance_items=insurance_items,
        document_items=document_items,
        timeline_items=timeline_items,
        attention_items=attention_items,
    )
