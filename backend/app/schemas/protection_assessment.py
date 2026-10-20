from typing import Literal

from pydantic import Field

from app.schemas.common import Contract


class ProtectionSummary(Contract):
    covered_count: int = Field(ge=0)
    attention_count: int = Field(ge=0)
    unknown_count: int = Field(ge=0)
    documents_needed_count: int = Field(ge=0)
    overall_status: Literal["ON_TRACK", "ATTENTION_NEEDED", "NEEDS_VERIFICATION"]
    overall_headline: str
    overall_score_text: str
    ready_pct: int | None = None


class ProtectionNeedItem(Contract):
    need_code: str
    title: str
    category: str
    description: str
    icon: str
    status: Literal["COVERED", "PARTIALLY_COVERED", "NOT_COVERED", "UNKNOWN", "NOT_APPLICABLE"]
    status_label: str
    status_explanation: str
    requirement_level: Literal["MANDATORY", "RECOMMENDED", "OPTIONAL"]
    why_it_matters: str
    evidence_summary: str
    evidence_sources: list[str] = Field(default_factory=list)
    suggested_next_steps: list[str] = Field(default_factory=list)
    has_unmet_need: bool = False
    matched_policy_ids: list[str] = Field(default_factory=list)
    product_candidate_ids: list[str] = Field(default_factory=list)
    date_gap_days: int | None = None
    date_gap_explanation: str | None = None


class KeyFindingItem(Contract):
    id: int
    title: str
    status: Literal["success", "warning", "danger", "info"]
    text: str
    category: str


class NextStepItem(Contract):
    id: int
    title: str
    description: str
    action_label: str
    action_url: str
    priority: Literal["HIGH", "MEDIUM", "LOW"]


class ProfileContextView(Contract):
    display_name: str
    occupation: str
    situation: str
    country_code: str
    residence_context: str
    city: str | None = None
    visa_status: str | None = None
    visa_expiry_date: str | None = None
    key_dates_summary: str | None = None
    has_dependents: bool = False
    dependents_summary: str = "None"
    declared_insurance: list[str] = Field(default_factory=list)


class RecentUpdateItem(Contract):
    date: str
    title: str
    related_to: str
    action_label: str
    action_url: str


class ProductOption(Contract):
    product_id: str
    insurer_name: str
    product_name: str
    badge: str | None = None
    annual_limit: str
    covers_basic_treatment: str
    covers_major_treatment: str
    waiting_period: str
    direct_billing: str
    worldwide_coverage: str
    estimated_premium: str
    key_features: list[str] = Field(default_factory=list)
    official_url: str
    verification_status: str = "VERIFIED"


class ProductComparisonRow(Contract):
    feature_name: str
    values: dict[str, str] = Field(default_factory=dict)


class ProductComparisonResponse(Contract):
    products: list[ProductOption]
    comparison_matrix: list[ProductComparisonRow]


class FullProtectionAssessment(Contract):
    assessment_id: str
    actor_type: str
    country_code: str
    assessment_version: str = "1.5.0"
    last_assessed_at: str
    refresh_reason: str
    summary: ProtectionSummary
    needs: list[ProtectionNeedItem]
    key_findings: list[KeyFindingItem]
    recommended_next_steps: list[NextStepItem]
    profile_context: ProfileContextView
    recent_updates: list[RecentUpdateItem]
    limitations: list[str] = Field(default_factory=list)


class ReassessRequest(Contract):
    force_refresh: bool = False
    notes: str | None = None
