"""Domain schemas for Family Protection Intelligence (SC-18, REG-61 to REG-66)."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import Field, JsonValue

from app.schemas.common import Contract


class FamilyCoverageStatus(StrEnum):
    COVERED = "COVERED"
    PARTIAL = "PARTIAL"
    NOT_COVERED = "NOT_COVERED"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    UNKNOWN = "UNKNOWN"


class FamilyBenefitKey(StrEnum):
    INPATIENT = "inpatient"
    OUTPATIENT = "outpatient"
    DENTAL = "dental"
    OPTICAL = "optical"
    MATERNITY = "maternity"
    EMERGENCY = "emergency"


class FamilyBenefitArea(Contract):
    benefit_key: str
    name: str
    icon: str
    status: FamilyCoverageStatus
    status_label: str
    policy_name: str
    note: str | None = None
    details: str | None = None


class FamilyPolicyLink(Contract):
    id: UUID
    family_member_id: UUID
    policy_ref: str
    policy_name: str
    provider_name: str
    policy_type: str
    policy_number_masked: str | None = None
    coverage_role: str
    status: str
    verification_status: str
    coverage_summary: str | None = None
    benefit_details: dict[str, JsonValue] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class FamilyPolicyLinkCreate(Contract):
    policy_ref: str = Field(min_length=1, max_length=100)
    policy_name: str = Field(min_length=1, max_length=200)
    provider_name: str = Field(min_length=1, max_length=200)
    policy_type: str = Field(default="EMPLOYER_GROUP", max_length=50)
    policy_number_masked: str | None = Field(default=None, max_length=50)
    coverage_role: str = Field(default="DEPENDENT", max_length=50)
    status: str = Field(default="ACTIVE", max_length=30)
    verification_status: str = Field(default="VERIFIED", max_length=30)
    coverage_summary: str | None = None
    benefit_details: dict[str, JsonValue] = Field(default_factory=dict)


class UnmetNeedItem(Contract):
    id: str
    title: str
    description: str
    severity: str = "MEDIUM"  # HIGH, MEDIUM, LOW, INFO
    benefit_key: str | None = None
    action_label: str = "Explore options"
    action_url: str = "/products/compare"


class AiInsightItem(Contract):
    id: str
    order: int
    title: str
    description: str
    action_label: str = "Explore options"
    action_url: str = "/products/compare"


class EligibilityRuleItem(Contract):
    id: str
    rule_name: str
    condition: str
    status: str  # ELIGIBLE, CONDITIONALLY_ELIGIBLE, INELIGIBLE, NEEDS_VERIFICATION
    notes: str


class FamilyMemberDetail(Contract):
    id: UUID
    name: str
    relation: str
    birth_date: str | None = None
    age: int | None = None
    age_label: str = ""
    is_primary: bool = False
    gender: str | None = None
    occupation: str | None = None
    notes: str | None = None
    avatar_url: str | None = None
    coverage_status: FamilyCoverageStatus = FamilyCoverageStatus.UNKNOWN
    coverage_status_label: str = "Unknown"
    coverage_subtitle: str | None = None
    linked_policies: list[FamilyPolicyLink] = Field(default_factory=list)
    benefits: list[FamilyBenefitArea] = Field(default_factory=list)
    unmet_needs: list[UnmetNeedItem] = Field(default_factory=list)
    ai_insights: list[AiInsightItem] = Field(default_factory=list)
    eligibility_rules: list[EligibilityRuleItem] = Field(default_factory=list)
    authorization_status: str = "AUTHORIZED"
    consent_confirmed: bool = True
    consent_details: dict[str, JsonValue] = Field(default_factory=dict)
    consent_at: datetime
    created_at: datetime
    updated_at: datetime


class FamilyMemberCreate(Contract):
    name: str = Field(min_length=1, max_length=200)
    relation: str = Field(min_length=1, max_length=50)
    birth_date: str | None = Field(default=None, max_length=10)
    gender: str | None = Field(default=None, max_length=20)
    occupation: str | None = Field(default=None, max_length=100)
    notes: str | None = None
    consent_confirmed: bool = True


class FamilyMemberUpdate(Contract):
    name: str | None = Field(default=None, max_length=200)
    relation: str | None = Field(default=None, max_length=50)
    birth_date: str | None = Field(default=None, max_length=10)
    gender: str | None = Field(default=None, max_length=20)
    occupation: str | None = Field(default=None, max_length=100)
    notes: str | None = None


class FamilyCoverageStatusSummary(Contract):
    coverage_score_percent: int
    headline: str
    description: str
    covered_count: int
    partial_count: int
    not_covered_count: int
    unknown_count: int
    total_members: int


class FamilyProtectionOverview(Contract):
    summary: FamilyCoverageStatusSummary
    members: list[FamilyMemberDetail]
    selected_member_id: UUID | None = None
    consent_summary: dict[str, JsonValue] = Field(default_factory=dict)


class FamilyConsentUpdate(Contract):
    consent_confirmed: bool
    authorization_scope: list[str] = Field(default_factory=list)
    legal_guardian_confirmed: bool = True


class FamilyAnalysisRequest(Contract):
    member_id: UUID | None = None
    include_external_ai: bool = True


class FamilyAnalysisResponse(Contract):
    overview: FamilyProtectionOverview
    analyzed_at: datetime
    ai_provider: str
    engine_notes: list[str] = Field(default_factory=list)
