from datetime import date

from app.schemas.assessment import AssessmentStatus, VisaCoverageAssessment
from app.schemas.common import EvidenceClass, RuleSource, VerificationStatus
from app.schemas.insurance import UnifiedInsuranceRecord
from app.schemas.profile import UserProfile
from app.services.intervals import uncovered_interval
from app.services.kb_loader import CountryKBLoader

REVIEW_MESSAGE = "Coverage dates require review."


def declared_period(profile: UserProfile, rule) -> tuple[date | None, date | None]:
    """Declared interval for a rule. Plain dates only; no jurisdiction wording."""
    param = rule.parameters if rule else None
    start = profile.arrival_date
    if param and param.start_field == "study_start_date":
        start = profile.study_start_date or profile.arrival_date
    end = profile.visa_expiry_date
    if param and param.end_field == "study_or_permit_end_date":
        candidates = [
            d
            for d in (profile.study_end_date, profile.permit_end_date, profile.visa_expiry_date)
            if d
        ]
        end = max(candidates) if candidates else None
    return start, end


class RulesEngine:
    def __init__(self, kb_loader: CountryKBLoader):
        self.kb_loader = kb_loader

    def assess_visa_coverage(
        self,
        profile: UserProfile,
        record: UnifiedInsuranceRecord,
        *,
        include_visa_rule: bool = False,
    ) -> VisaCoverageAssessment:
        """Compare declared period and policy dates.

        Demo/legacy callers only match `coverage_continuity` rules (date-difference statuses).
        Workspace callers (SC-04/SC-14) pass `include_visa_rule=True` to also apply
        `visa_coverage` rules, which yield GAP_FOUND/PASS/NEEDS_VERIFICATION.
        """
        kb = self.kb_loader.load(profile.country_code)
        rule_kinds = {"coverage_continuity"} | ({"visa_coverage"} if include_visa_rule else set())
        applicable_rules = [
            rule
            for rule in kb.rules
            if rule.kind in rule_kinds
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
        if len(applicable_rules) != 1:
            if applicable_rules:
                return VisaCoverageAssessment(
                    applicable=True,
                    assessment_status=AssessmentStatus.NEEDS_VERIFICATION,
                    gap_periods=[],
                    explanation=(
                        "Overlapping continuity rules need review before they can be applied."
                    ),
                )
        rule = applicable_rules[0] if applicable_rules else None
        source = (
            RuleSource(
                country_code=kb.manifest.country_code,
                kb_version=kb.manifest.version,
                rule_id=rule.rule_id,
                source_url=rule.source_url,
                checked_at=rule.checked_at,
                verification_status=rule.verification_status,
            )
            if rule
            else None
        )
        start, end = declared_period(profile, rule)
        legacy_rule = next((item for item in kb.rules if item.kind == "visa_coverage"), None)
        policy_types = (
            rule.parameters.policy_types
            if rule
            else (legacy_rule.parameters.policy_types if legacy_rule else [])
        )
        policies = [p for p in record.policies if not policy_types or p.policy_type in policy_types]
        if (
            not start
            or not end
            or not policies
            or any(p.coverage_start_date is None or p.coverage_end_date is None for p in policies)
        ):
            return VisaCoverageAssessment(
                applicable=bool(rule),
                assessment_status=AssessmentStatus.UNABLE_TO_DETERMINE,
                gap_periods=[],
                requirement_status="VERIFIED"
                if rule and rule.verification_status == VerificationStatus.VERIFIED
                else "NEEDS_VERIFICATION",
                explanation=(
                    "Unable to determine continuity because policy end dates or declared "
                    "period dates are unavailable."
                ),
                rule_source=source,
            )
        # Union all qualifying coverage intervals, clipped to the required inclusive interval.
        # Python ordinals avoid overflow even at date.max. No LLM performs arithmetic.
        days, gaps = uncovered_interval(
            start,
            end,
            [
                (p.coverage_start_date, p.coverage_end_date)
                for p in policies
                if p.coverage_start_date is not None and p.coverage_end_date is not None
            ],
        )
        verified = bool(
            rule
            and rule.verification_status == VerificationStatus.VERIFIED
            and kb.manifest.verification_status == VerificationStatus.VERIFIED
            and all(p.verification_status == VerificationStatus.VERIFIED for p in policies)
            and source.source_url is not None
            and source.checked_at is not None
        )
        if rule and rule.kind == "visa_coverage":
            status = (
                AssessmentStatus.GAP_FOUND
                if days and verified
                else AssessmentStatus.NEEDS_VERIFICATION
                if days
                else AssessmentStatus.PASS
                if verified
                else AssessmentStatus.NEEDS_VERIFICATION
            )
        elif (
            rule and days and not verified and rule.evidence_class == EvidenceClass.MANUALLY_CURATED
        ):
            # Generic, non-official continuity check: report the interval for review only.
            status = AssessmentStatus.NEEDS_VERIFICATION
        else:
            status = (
                AssessmentStatus.POTENTIAL_COVERAGE_GAP
                if days and verified
                else AssessmentStatus.DATE_DIFFERENCE_DETECTED
                if days
                else AssessmentStatus.NO_DATE_DIFFERENCE
            )
        return VisaCoverageAssessment(
            applicable=bool(rule),
            assessment_status=status,
            requirement_status="VERIFIED" if verified else "NEEDS_VERIFICATION",
            gap_days=days,
            gap_periods=gaps,
            explanation=(
                REVIEW_MESSAGE
                if status == AssessmentStatus.NEEDS_VERIFICATION
                and rule
                and rule.kind == "coverage_continuity"
                else f"A {days}-day difference was detected between the declared period "
                "and policy dates. "
                "This is a date comparison, not a visa or immigration violation."
                if days
                else (
                    "No date difference was detected for the dates provided. This does not "
                    "establish that an institution requirement is met."
                )
            ),
            rule_source=source,
        )
