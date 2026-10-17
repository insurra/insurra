from enum import StrEnum

from pydantic import Field

from app.schemas.common import CompletenessStatus, Contract, DateRange, RuleSource
from app.schemas.document import SourceEvidence


class CompletenessItem(Contract):
    requirement_code: str
    label: str
    status: CompletenessStatus
    explanation: str
    source_evidence: SourceEvidence | None = None
    rule_source: RuleSource | None = None


class RequirementLevel(StrEnum):
    REQUIRED = "REQUIRED"
    RECOMMENDED = "RECOMMENDED"


class OwnershipStatus(StrEnum):
    OWNED = "OWNED"
    NOT_OWNED = "NOT_OWNED"
    NEEDS_CHECK = "NEEDS_CHECK"


class CoverageNeed(Contract):
    need_code: str
    label: str
    requirement_level: RequirementLevel
    ownership_status: OwnershipStatus
    explanation: str
    source_reference: RuleSource | None = None


class AssessmentStatus(StrEnum):
    PASS = "PASS"
    GAP_FOUND = "GAP_FOUND"
    NEEDS_VERIFICATION = "NEEDS_VERIFICATION"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class VisaCoverageAssessment(Contract):
    applicable: bool
    assessment_status: AssessmentStatus
    gap_days: int | None = Field(default=None, ge=0)
    gap_periods: list[DateRange]
    explanation: str
    rule_source: RuleSource | None = None
