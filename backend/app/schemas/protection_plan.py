from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import Contract, CountryCode


class ProtectionFindingStatus(StrEnum):
    MET = "MET"
    POTENTIAL_GAP = "POTENTIAL_GAP"
    NEEDS_VERIFICATION = "NEEDS_VERIFICATION"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class EvidenceBasis(StrEnum):
    PROFILE = "PROFILE"
    SELF_REPORTED = "SELF_REPORTED"
    VERIFIED_EVIDENCE = "VERIFIED_EVIDENCE"
    OFFICIAL_RULE = "OFFICIAL_RULE"


class EligibilityState(StrEnum):
    POTENTIAL_MATCH = "POTENTIAL_MATCH"
    UNKNOWN = "UNKNOWN"


class AssessmentAgentStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class RequirementLevel(StrEnum):
    REQUIRED_VERIFIED = "REQUIRED_VERIFIED"
    RECOMMENDED = "RECOMMENDED"
    OPTIONAL = "OPTIONAL"


class MatchedCoverageEvidence(Contract):
    coverage_id: str | None = None
    provider: str
    plan_name: str
    policy_type: str | None = None
    benefit_name: str
    benefit_limit: str | None = None
    verification_status: str
    source_origin: str


class NeedDetail(Contract):
    code: str
    title: str
    category: str
    status: str
    requirement_level: RequirementLevel
    reason: str
    evidence_basis: list[str] = Field(default_factory=list)
    matched_coverage: list[MatchedCoverageEvidence] = Field(default_factory=list)
    limits_summary: str | None = None
    risks: list[str] = Field(default_factory=list)
    applicable_next_steps: list[str] = Field(default_factory=list)
    uncovered_days: int | None = None
    rule_id: str | None = None


class AssessmentSummary(Contract):
    what_is_covered: list[str] = Field(default_factory=list)
    what_needs_attention: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list, max_length=5)


class ProtectionFinding(Contract):
    code: str
    title: str
    status: ProtectionFindingStatus
    reason: str
    evidence_basis: list[EvidenceBasis]
    category: str
    next_step: str


class ProductCandidate(Contract):
    product_id: str
    insurer_name: str
    product_name: str
    category: str
    eligibility: EligibilityState
    match_reasons: list[str] = Field(max_length=5)
    limitations: list[str] = Field(max_length=6)
    official_source_url: str
    source_checked_at: str | None = None
    verification_status: str
    pricing_available: bool


class PersonalProtectionPlan(Contract):
    country_code: CountryCode
    profile_version: str = "1.5"
    health_profile_used: bool
    document_evidence_used: bool
    findings: list[ProtectionFinding]
    product_candidates: list[ProductCandidate]
    overall_summary: str
    limitations: list[str]


class ProtectionAssessmentDetail(Contract):
    id: UUID
    assessment_version: str = "1.5.0"
    status: AssessmentAgentStatus = AssessmentAgentStatus.COMPLETED
    covered_count: int = 0
    attention_count: int = 0
    unknown_count: int = 0
    documents_needed_count: int = 0
    overall_status: str = "ON_TRACK"
    overall_headline: str = ""
    summary: AssessmentSummary
    needs: list[NeedDetail] = Field(default_factory=list)
    product_candidates: list[ProductCandidate] = Field(default_factory=list)
    changed_findings: list[str] = Field(default_factory=list)
    refresh_reason: str = "INITIAL_ASSESSMENT"
    input_hash: str | None = None
    agent_logs: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AssessmentRunRequest(Contract):
    force: bool = False
    trigger_reason: str = "USER_REQUESTED"
