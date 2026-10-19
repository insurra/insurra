from datetime import date, timedelta

from app.schemas.assessment import AssessmentStatus, VisaCoverageAssessment
from app.schemas.common import DateRange, RuleSource, VerificationStatus
from app.schemas.insurance import UnifiedInsuranceRecord
from app.schemas.profile import UserProfile
from app.services.kb_loader import CountryKBLoader


def uncovered_interval(start: date, end: date, intervals: list[tuple[date, date]]):
    """Union/clamp inclusive calendar intervals. Shared by demo, SC-04 and SC-14."""
    ranges = sorted(
        (max(start.toordinal(), left.toordinal()), min(end.toordinal(), right.toordinal()))
        for left, right in intervals
    )
    cursor, end_day = start.toordinal(), end.toordinal()
    gaps: list[DateRange] = []
    for left, right in ranges:
        if left > right:
            continue
        if left > cursor:
            gaps.append(
                DateRange(start_date=date.fromordinal(cursor), end_date=date.fromordinal(left - 1))
            )
        cursor = max(cursor, right + 1)
    if cursor <= end_day:
        gaps.append(DateRange(start_date=date.fromordinal(cursor), end_date=end))
    return sum((g.end_date - g.start_date + timedelta(days=1)).days for g in gaps), gaps


class RulesEngine:
    def __init__(self, kb_loader: CountryKBLoader):
        self.kb_loader = kb_loader

    def assess_visa_coverage(
        self, profile: UserProfile, record: UnifiedInsuranceRecord
    ) -> VisaCoverageAssessment:
        kb = self.kb_loader.load(profile.country_code)
        applicable_rules = [
            rule
            for rule in kb.rules
            if rule.kind == "visa_coverage"
            and (
                not rule.applicability.occupation
                or profile.occupation in rule.applicability.occupation
            )
            and (
                not rule.applicability.residence_context
                or profile.residence_context in rule.applicability.residence_context
            )
        ]
        if record.country_code != profile.country_code:
            return VisaCoverageAssessment(
                applicable=bool(applicable_rules),
                assessment_status=AssessmentStatus.NEEDS_VERIFICATION,
                gap_periods=[],
                explanation=(
                    f"Policy and document records come from {record.country_code}, "
                    f"while the current profile context is {profile.country_code}. "
                    "Coverage fit is not yet verified. The original data is preserved."
                ),
            )
        if not applicable_rules:
            return VisaCoverageAssessment(
                applicable=False,
                assessment_status=AssessmentStatus.NOT_APPLICABLE,
                gap_periods=[],
                explanation="No visa interval rule applies to this profile.",
            )
        if len(applicable_rules) != 1:
            return VisaCoverageAssessment(
                applicable=True,
                assessment_status=AssessmentStatus.NEEDS_VERIFICATION,
                gap_periods=[],
                explanation="Konfigurasi aturan tumpang tindih; perlu ditinjau.",
            )
        rule = applicable_rules[0]
        source = RuleSource(
            country_code=kb.manifest.country_code,
            kb_version=kb.manifest.version,
            rule_id=rule.rule_id,
            source_url=rule.source_url,
            checked_at=rule.checked_at,
            verification_status=rule.verification_status,
        )
        start: date | None = getattr(profile, rule.parameters.start_field)
        end: date | None = getattr(profile, rule.parameters.end_field)
        policies = [p for p in record.policies if p.policy_type in rule.parameters.policy_types]
        explanation = (
            "The interval calculation uses inclusive end dates. "
            "This result is not a finding of a visa breach; "
            "the rules and your policy still need to be verified."
        )
        if (
            not start
            or not end
            or not policies
            or any(p.coverage_start_date is None or p.coverage_end_date is None for p in policies)
        ):
            return VisaCoverageAssessment(
                applicable=True,
                assessment_status=AssessmentStatus.NEEDS_VERIFICATION,
                gap_periods=[],
                explanation="Policy dates or context are incomplete. " + explanation,
                rule_source=source,
            )
        days, gaps = uncovered_interval(
            start,
            end,
            [
                (p.coverage_start_date, p.coverage_end_date)
                for p in policies
                if p.coverage_start_date is not None and p.coverage_end_date is not None
            ],
        )
        verified = (
            rule.verification_status == VerificationStatus.VERIFIED
            and kb.manifest.verification_status == VerificationStatus.VERIFIED
            and all(p.verification_status == VerificationStatus.VERIFIED for p in policies)
            and source.source_url is not None
            and source.checked_at is not None
        )
        status = (
            (AssessmentStatus.GAP_FOUND if days else AssessmentStatus.PASS)
            if verified
            else (AssessmentStatus.NEEDS_VERIFICATION)
        )
        return VisaCoverageAssessment(
            applicable=True,
            assessment_status=status,
            gap_days=days,
            gap_periods=gaps,
            explanation=explanation,
            rule_source=source,
        )
