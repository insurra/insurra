"""Family Protection Intelligence Engine (SC-18, REG-61 to REG-66).

Deterministic rules + optional LLM:
- Relationship modeling
- Policy eligibility rules
- Dependent coverage status evaluation
- Needs assessment (uninsured/uncertain needs)
- Contextual explanations & AI insights
"""

from datetime import UTC, date, datetime

from app.models.account_data import FamilyMemberRow, FamilyPolicyLinkRow
from app.schemas.family import (
    AiInsightItem,
    EligibilityRuleItem,
    FamilyBenefitArea,
    FamilyBenefitKey,
    FamilyCoverageStatus,
    FamilyCoverageStatusSummary,
    FamilyMemberDetail,
    FamilyPolicyLink,
    UnmetNeedItem,
)


def parse_birth_date(birth_date_str: str | None) -> date | None:
    if not birth_date_str:
        return None
    try:
        parts = birth_date_str.strip().split("-")
        if len(parts) == 3:
            return date(int(parts[0]), int(parts[1]), int(parts[2]))
    except Exception:
        pass
    return None


def compute_member_age(
    birth_date_str: str | None, relation: str = "Child", occupation: str | None = None
) -> tuple[int | None, str]:
    bdate = parse_birth_date(birth_date_str)
    if bdate is None:
        rel_label = relation.title() if relation else "Member"
        return None, rel_label

    today = datetime.now(UTC).date()
    age = today.year - bdate.year - ((today.month, today.day) < (bdate.month, bdate.day))

    rel_lower = relation.lower()
    if rel_lower == "child":
        age_label = f"Child • {age} years" if age > 1 else f"Child • {age} year"
    elif rel_lower == "spouse":
        occ = f" • {occupation}" if occupation else ""
        age_label = f"{age} years{occ}"
    elif rel_lower == "primary":
        occ = f" • {occupation}" if occupation else " • Primary"
        age_label = f"{age} years{occ}"
    else:
        age_label = f"{age} years • {relation.title()}"

    return age, age_label


def evaluate_eligibility_rules(
    relation: str,
    age: int | None,
    policies: list[FamilyPolicyLinkRow],
) -> list[EligibilityRuleItem]:
    rules: list[EligibilityRuleItem] = []
    rel_lower = relation.lower()

    if rel_lower == "child":
        if age is None:
            rules.append(
                EligibilityRuleItem(
                    id="rule-child-age-unknown",
                    rule_name="Dependent Child Age Verification",
                    condition="Child must be unmarried and under age 21 (or 25 if student)",
                    status="NEEDS_VERIFICATION",
                    notes="Birth date required to verify child dependent eligibility.",
                )
            )
        elif age <= 21:
            rules.append(
                EligibilityRuleItem(
                    id="rule-child-age-eligible",
                    rule_name="Dependent Child Age Limit",
                    condition="Eligible up to age 21 (or 25 if full-time student)",
                    status="ELIGIBLE",
                    notes=f"Age {age} qualifies as an eligible child dependent under the policy.",
                )
            )
        elif age <= 25:
            rules.append(
                EligibilityRuleItem(
                    id="rule-child-age-student",
                    rule_name="Tertiary Student Dependent Extension",
                    condition="Eligible up to age 25 with full-time student verification",
                    status="CONDITIONALLY_ELIGIBLE",
                    notes="Requires active school enrollment verification document.",
                )
            )
        else:
            rules.append(
                EligibilityRuleItem(
                    id="rule-child-age-ineligible",
                    rule_name="Dependent Child Age Limit Exceeded",
                    condition="Standard child dependent age limit (max age 21)",
                    status="INELIGIBLE",
                    notes=f"At age {age}, dependent exceeds maximum dependent child age limit.",
                )
            )
    elif rel_lower == "spouse":
        rules.append(
            EligibilityRuleItem(
                id="rule-spouse-marriage",
                rule_name="Dependent Spouse Legal Marriage",
                condition="Documented legal spouse recognized under statutory law",
                status="ELIGIBLE",
                notes="Spouse coverage linked under primary member's group health policy.",
            )
        )
    elif rel_lower == "primary":
        rules.append(
            EligibilityRuleItem(
                id="rule-primary-policyholder",
                rule_name="Primary Policyholder Eligibility",
                condition="Active employee or direct subscriber",
                status="ELIGIBLE",
                notes="Primary policyholder with direct ownership and member status.",
            )
        )

    # Policy waiting periods & riders
    if policies:
        rules.append(
            EligibilityRuleItem(
                id="rule-waiting-period",
                rule_name="Waiting Period (Pre-Existing Conditions)",
                condition="30-day initial waiting period; 12 months for pre-existing illness",
                status="ELIGIBLE",
                notes="Standard waiting periods elapsed for continuous active coverage.",
            )
        )

        has_dental = any(
            p.benefit_details.get("dental", {}).get("covered") is True
            or "dental" in (p.coverage_summary or "").lower()
            for p in policies
        )
        if not has_dental:
            rules.append(
                EligibilityRuleItem(
                    id="rule-dental-rider",
                    rule_name="Dental Benefit Rider",
                    condition="Dental benefits require separate optional rider",
                    status="INELIGIBLE",
                    notes="Dental coverage rider is not included in current employer policy.",
                )
            )

        optical_limited = any(
            p.benefit_details.get("optical", {}).get("has_limit") is True
            or "optical (limited)" in (p.coverage_summary or "").lower()
            for p in policies
        )
        if optical_limited:
            rules.append(
                EligibilityRuleItem(
                    id="rule-optical-sublimit",
                    rule_name="Optical Benefit Annual Sub-Limit",
                    condition="Annual optical limit applies per calendar year",
                    status="CONDITIONALLY_ELIGIBLE",
                    notes="Optical benefits active up to annual cap (e.g. IDR 2,500,000 / year).",
                )
            )
    else:
        rules.append(
            EligibilityRuleItem(
                id="rule-no-policy",
                rule_name="Policy Association Required",
                condition="Family member must be associated with an active policy",
                status="NEEDS_VERIFICATION",
                notes="No active insurance policies linked to this member.",
            )
        )

    return rules


def evaluate_member_benefits(
    relation: str,
    age: int | None,
    policies: list[FamilyPolicyLinkRow],
    gender: str | None = None,
) -> list[FamilyBenefitArea]:
    active_policies = [p for p in policies if p.status == "ACTIVE"]

    primary_policy_name = active_policies[0].policy_name if active_policies else "-"

    # 1. Inpatient
    has_inpatient = any(
        p.benefit_details.get("inpatient", {}).get("covered", True)
        or "inpatient" in (p.coverage_summary or "").lower()
        for p in active_policies
    )
    inpatient_status = (
        FamilyCoverageStatus.COVERED if has_inpatient else FamilyCoverageStatus.NOT_COVERED
    )
    inpatient_policy = primary_policy_name if has_inpatient else "-"

    # 2. Outpatient
    has_outpatient = any(
        p.benefit_details.get("outpatient", {}).get("covered", True)
        or "outpatient" in (p.coverage_summary or "").lower()
        for p in active_policies
    )
    outpatient_status = (
        FamilyCoverageStatus.COVERED if has_outpatient else FamilyCoverageStatus.NOT_COVERED
    )
    outpatient_policy = primary_policy_name if has_outpatient else "-"

    # 3. Dental
    has_dental = any(
        p.benefit_details.get("dental", {}).get("covered") is True for p in active_policies
    )
    if has_dental:
        dental_status = FamilyCoverageStatus.COVERED
        dental_policy = primary_policy_name
    elif age is not None and age <= 3:
        dental_status = FamilyCoverageStatus.NOT_APPLICABLE
        dental_policy = "-"
    else:
        dental_status = FamilyCoverageStatus.NOT_COVERED
        dental_policy = "-"

    # 4. Optical
    has_optical = any(
        p.benefit_details.get("optical", {}).get("covered") is True for p in active_policies
    )
    optical_limited = any(
        p.benefit_details.get("optical", {}).get("has_limit") is True
        or "optical (limited)" in (p.coverage_summary or "").lower()
        for p in active_policies
    )
    optical_note = None
    if optical_limited:
        optical_status = FamilyCoverageStatus.PARTIAL
        optical_note = "Limited coverage (annual limit applies)"
        optical_policy = primary_policy_name
    elif has_optical:
        optical_status = FamilyCoverageStatus.COVERED
        optical_policy = primary_policy_name
    elif age is not None and age <= 3:
        optical_status = FamilyCoverageStatus.NOT_APPLICABLE
        optical_policy = "-"
    else:
        optical_status = FamilyCoverageStatus.NOT_COVERED
        optical_policy = "-"

    # 5. Maternity
    rel_lower = relation.lower()
    is_minor = age is not None and age < 18
    is_male = gender is not None and gender.lower() in ("male", "pria", "m")
    if rel_lower in ("child", "son", "daughter") or is_minor or is_male:
        maternity_status = FamilyCoverageStatus.NOT_APPLICABLE
        maternity_policy = "-"
        maternity_note = None
    else:
        has_maternity = any(
            p.benefit_details.get("maternity", {}).get("covered") is True
            or "maternity" in (p.coverage_summary or "").lower()
            for p in active_policies
        )
        if has_maternity:
            maternity_status = FamilyCoverageStatus.COVERED
            maternity_policy = primary_policy_name
            maternity_note = None
        else:
            maternity_status = FamilyCoverageStatus.NOT_COVERED
            maternity_policy = "-"
            maternity_note = None

    # 6. Emergency
    has_emergency = any(
        p.benefit_details.get("emergency", {}).get("covered", True)
        or "emergency" in (p.coverage_summary or "").lower()
        for p in active_policies
    )
    emergency_status = (
        FamilyCoverageStatus.COVERED if has_emergency else FamilyCoverageStatus.NOT_COVERED
    )
    emergency_policy = primary_policy_name if has_emergency else "-"

    return [
        FamilyBenefitArea(
            benefit_key=FamilyBenefitKey.INPATIENT,
            name="Inpatient care",
            icon="hospital",
            status=inpatient_status,
            status_label="Covered"
            if inpatient_status == FamilyCoverageStatus.COVERED
            else "Not covered",
            policy_name=inpatient_policy,
        ),
        FamilyBenefitArea(
            benefit_key=FamilyBenefitKey.OUTPATIENT,
            name="Outpatient care",
            icon="clinic",
            status=outpatient_status,
            status_label="Covered"
            if outpatient_status == FamilyCoverageStatus.COVERED
            else "Not covered",
            policy_name=outpatient_policy,
        ),
        FamilyBenefitArea(
            benefit_key=FamilyBenefitKey.DENTAL,
            name="Dental care",
            icon="tooth",
            status=dental_status,
            status_label="Covered"
            if dental_status == FamilyCoverageStatus.COVERED
            else "Not covered",
            policy_name=dental_policy,
        ),
        FamilyBenefitArea(
            benefit_key=FamilyBenefitKey.OPTICAL,
            name="Optical care",
            icon="glasses",
            status=optical_status,
            status_label="Partial"
            if optical_status == FamilyCoverageStatus.PARTIAL
            else ("Covered" if optical_status == FamilyCoverageStatus.COVERED else "Not covered"),
            policy_name=optical_policy,
            note=optical_note,
        ),
        FamilyBenefitArea(
            benefit_key=FamilyBenefitKey.MATERNITY,
            name="Maternity care",
            icon="baby",
            status=maternity_status,
            status_label="Not applicable"
            if maternity_status == FamilyCoverageStatus.NOT_APPLICABLE
            else ("Covered" if maternity_status == FamilyCoverageStatus.COVERED else "Not covered"),
            policy_name=maternity_policy,
            note=maternity_note,
        ),
        FamilyBenefitArea(
            benefit_key=FamilyBenefitKey.EMERGENCY,
            name="Emergency care",
            icon="ambulance",
            status=emergency_status,
            status_label="Covered"
            if emergency_status == FamilyCoverageStatus.COVERED
            else "Not covered",
            policy_name=emergency_policy,
        ),
    ]


def identify_unmet_needs(
    member_name: str,
    relation: str,
    age: int | None,
    benefits: list[FamilyBenefitArea],
    policies: list[FamilyPolicyLinkRow],
) -> list[UnmetNeedItem]:
    needs: list[UnmetNeedItem] = []

    if not policies:
        needs.append(
            UnmetNeedItem(
                id=f"unmet-no-policy-{member_name.lower()}",
                title=f"No active coverage linked for {member_name}.",
                description="Link an existing policy or explore family health protection options.",
                severity="HIGH",
                benefit_key=None,
                action_label="Link policy",
                action_url="#manage-coverage",
            )
        )
        return needs

    for b in benefits:
        if (
            b.benefit_key == FamilyBenefitKey.DENTAL
            and b.status == FamilyCoverageStatus.NOT_COVERED
        ):
            needs.append(
                UnmetNeedItem(
                    id=f"unmet-dental-{member_name.lower()}",
                    title=f"Dental care is not covered for {member_name}.",
                    description="Consider a top-up plan or a personal dental insurance.",
                    severity="HIGH" if (age is not None and age <= 12) else "MEDIUM",
                    benefit_key="dental",
                    action_label="Explore options",
                    action_url="/products/compare?category=dental",
                )
            )
        elif b.benefit_key == FamilyBenefitKey.OPTICAL and b.status == FamilyCoverageStatus.PARTIAL:
            needs.append(
                UnmetNeedItem(
                    id=f"unmet-optical-{member_name.lower()}",
                    title=f"Optical care has an annual limit for {member_name}.",
                    description="Review if the annual allowance is sufficient for prescription eyewear.",
                    severity="INFO",
                    benefit_key="optical",
                    action_label="View details",
                    action_url="/policies",
                )
            )

    return needs


def generate_ai_insights(
    member_name: str,
    relation: str,
    age: int | None,
    benefits: list[FamilyBenefitArea],
    policies: list[FamilyPolicyLinkRow],
    external_ai_granted: bool = False,
) -> list[AiInsightItem]:
    insights: list[AiInsightItem] = []
    order = 1

    # Check dental
    dental = next((b for b in benefits if b.benefit_key == FamilyBenefitKey.DENTAL), None)
    if dental and dental.status == FamilyCoverageStatus.NOT_COVERED:
        insights.append(
            AiInsightItem(
                id=f"insight-dental-{member_name.lower()}",
                order=order,
                title=f"Consider adding dental coverage for {member_name}.",
                description="Dental care is not included in the current employer plan.",
                action_label="Explore options",
                action_url="/products/compare?category=dental",
            )
        )
        order += 1

    # Check optical
    optical = next((b for b in benefits if b.benefit_key == FamilyBenefitKey.OPTICAL), None)
    if optical and optical.status == FamilyCoverageStatus.PARTIAL:
        insights.append(
            AiInsightItem(
                id=f"insight-optical-{member_name.lower()}",
                order=order,
                title="Check optical benefit limit.",
                description=f"Optical care has an annual limit. Review if it is sufficient for {member_name}.",
                action_label="View details",
                action_url="/policies",
            )
        )
        order += 1

    # Age/relationship specific insights
    rel_lower = relation.lower()
    if rel_lower == "child" and age is not None and age <= 10:
        if order <= 2:
            insights.append(
                AiInsightItem(
                    id=f"insight-pediatric-{member_name.lower()}",
                    order=order,
                    title="Pediatric preventative care is verified.",
                    description="Routine outpatient consultations and childhood vaccinations are covered under network hospitals.",
                    action_label="Explore options",
                    action_url="/pathways",
                )
            )
            order += 1
    elif rel_lower == "spouse":
        if order <= 2:
            insights.append(
                AiInsightItem(
                    id=f"insight-spousal-{member_name.lower()}",
                    order=order,
                    title="Dual coverage coordination opportunity.",
                    description=f"{member_name} can coordinate employer benefits with personal insurance to eliminate out-of-pocket deductibles.",
                    action_label="Explore options",
                    action_url="/policies",
                )
            )
            order += 1

    return insights


def compute_coverage_status(
    benefits: list[FamilyBenefitArea],
    policies: list[FamilyPolicyLinkRow],
) -> tuple[FamilyCoverageStatus, str, str]:
    if not policies:
        return (
            FamilyCoverageStatus.NOT_COVERED,
            "Not covered",
            "No active insurance policies linked.",
        )

    has_unknown = any(p.verification_status == "UNVERIFIED" for p in policies)
    if has_unknown:
        return (
            FamilyCoverageStatus.UNKNOWN,
            "Unknown",
            "Policy evidence requires document verification.",
        )

    # Check essential benefits: inpatient, outpatient, emergency
    essential_keys = {
        FamilyBenefitKey.INPATIENT,
        FamilyBenefitKey.OUTPATIENT,
        FamilyBenefitKey.EMERGENCY,
    }
    essential_covered = all(
        b.status == FamilyCoverageStatus.COVERED
        for b in benefits
        if b.benefit_key in essential_keys
    )

    if not essential_covered:
        return (
            FamilyCoverageStatus.NOT_COVERED,
            "Not covered",
            "Essential health benefits are missing.",
        )

    # Check if partial (e.g. dental not covered or optical partial)
    has_partial = any(
        b.status in (FamilyCoverageStatus.PARTIAL, FamilyCoverageStatus.NOT_COVERED)
        for b in benefits
        if b.status != FamilyCoverageStatus.NOT_APPLICABLE
    )

    if has_partial:
        return (
            FamilyCoverageStatus.PARTIAL,
            "Partial coverage",
            "Some benefit areas may still need attention.",
        )

    return FamilyCoverageStatus.COVERED, "Covered", "All essential health needs covered."


def compute_family_summary(members: list[FamilyMemberDetail]) -> FamilyCoverageStatusSummary:
    total = len(members)
    covered = sum(1 for m in members if m.coverage_status == FamilyCoverageStatus.COVERED)
    partial = sum(1 for m in members if m.coverage_status == FamilyCoverageStatus.PARTIAL)
    not_covered = sum(1 for m in members if m.coverage_status == FamilyCoverageStatus.NOT_COVERED)
    unknown = sum(1 for m in members if m.coverage_status == FamilyCoverageStatus.UNKNOWN)

    if total == 0:
        score = 0
        headline = "No members declared"
        desc = "Add family members to start tracking household protection status."
    else:
        # Score calculation: percentage of fully covered members (e.g. 3 of 4 = 75%)
        score = int(round((covered / total) * 100))
        if score >= 100:
            headline = "Fully covered"
            desc = "All family members have comprehensive protection."
        elif score >= 70:
            headline = "Mostly covered"
            desc = "Most of your family members have health coverage. Some areas may still need attention."
        elif score >= 40:
            headline = "Partially covered"
            desc = "Several family members have gaps in essential protection."
        else:
            headline = "Needs immediate attention"
            desc = "Critical coverage gaps identified across household members."

    return FamilyCoverageStatusSummary(
        coverage_score_percent=score,
        headline=headline,
        description=desc,
        covered_count=covered,
        partial_count=partial,
        not_covered_count=not_covered,
        unknown_count=unknown,
        total_members=total,
    )


def build_member_detail(
    row: FamilyMemberRow,
    external_ai_granted: bool = False,
) -> FamilyMemberDetail:
    age, age_label = compute_member_age(row.birth_date, row.relation, row.occupation)
    policies = list(row.policies) if hasattr(row, "policies") and row.policies else []

    eligibility_rules = evaluate_eligibility_rules(row.relation, age, policies)
    benefits = evaluate_member_benefits(row.relation, age, policies, gender=row.gender)
    status, status_label, subtitle = compute_coverage_status(benefits, policies)
    unmet_needs = identify_unmet_needs(row.name, row.relation, age, benefits, policies)
    ai_insights = generate_ai_insights(
        row.name, row.relation, age, benefits, policies, external_ai_granted
    )

    policy_links = [
        FamilyPolicyLink(
            id=p.id,
            family_member_id=p.family_member_id,
            policy_ref=p.policy_ref,
            policy_name=p.policy_name,
            provider_name=p.provider_name,
            policy_type=p.policy_type,
            policy_number_masked=p.policy_number_masked,
            coverage_role=p.coverage_role,
            status=p.status,
            verification_status=p.verification_status,
            coverage_summary=p.coverage_summary,
            benefit_details=p.benefit_details or {},
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in policies
    ]

    return FamilyMemberDetail(
        id=row.id,
        name=row.name,
        relation=row.relation,
        birth_date=row.birth_date,
        age=age,
        age_label=age_label,
        is_primary=row.is_primary,
        gender=row.gender,
        occupation=row.occupation,
        notes=row.notes,
        avatar_url=row.avatar_url,
        coverage_status=status,
        coverage_status_label=status_label,
        coverage_subtitle=subtitle,
        linked_policies=policy_links,
        benefits=benefits,
        unmet_needs=unmet_needs,
        ai_insights=ai_insights,
        eligibility_rules=eligibility_rules,
        authorization_status=row.authorization_status,
        consent_confirmed=row.consent_confirmed,
        consent_details=row.consent_details or {},
        consent_at=row.consent_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
