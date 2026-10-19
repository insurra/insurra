from enum import StrEnum
from typing import Literal
from uuid import UUID

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


NeedApplicability = Literal[
    "REQUIRED_VERIFIED",
    "RECOMMENDED",
    "APPLICABILITY_UNVERIFIED",
    "NOT_APPLICABLE",
]

NeedEvidenceState = Literal[
    "HAVE_COVERAGE",
    "MISSING_EVIDENCE",
    "POTENTIAL_GAP",
    "NEEDS_VERIFICATION",
    "NOT_APPLICABLE",
]


class ContinuitySummary(Contract):
    uncovered_days: int | None = None
    interval_start: str | None = None
    interval_end: str | None = None
    compared_to: str | None = None
    rule_id: str | None = None
    rule_verification_status: str = "UNVERIFIED"


class CoverageNeed(Contract):
    need_code: str
    label: str
    requirement_level: RequirementLevel
    ownership_status: OwnershipStatus
    applicability: NeedApplicability = "RECOMMENDED"
    evidence_state: NeedEvidenceState = "NEEDS_VERIFICATION"
    explanation: str
    source_reference: RuleSource | None = None
    requirement_confirmed: bool = False
    coverage_ids: list[UUID] = Field(default_factory=list)
    verification_steps: list[str] = Field(default_factory=list)
    action_url: str = "/documents"
    visa_assessment: "VisaCoverageAssessment | None" = None
    continuity: ContinuitySummary | None = None
    exclusion: SourceEvidence | None = None


class AssessmentStatus(StrEnum):
    UNABLE_TO_DETERMINE = "UNABLE_TO_DETERMINE"
    NO_DATE_DIFFERENCE = "NO_DATE_DIFFERENCE"
    DATE_DIFFERENCE_DETECTED = "DATE_DIFFERENCE_DETECTED"
    POTENTIAL_COVERAGE_GAP = "POTENTIAL_COVERAGE_GAP"
    PASS = "PASS"
    GAP_FOUND = "GAP_FOUND"
    NEEDS_VERIFICATION = "NEEDS_VERIFICATION"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class VisaCoverageAssessment(Contract):
    applicable: bool
    assessment_status: AssessmentStatus
    requirement_status: Literal["VERIFIED", "NEEDS_VERIFICATION"] = "NEEDS_VERIFICATION"
    gap_days: int | None = Field(default=None, ge=0)
    gap_periods: list[DateRange]
    explanation: str
    rule_source: RuleSource | None = None


CoverageNeed.model_rebuild()
