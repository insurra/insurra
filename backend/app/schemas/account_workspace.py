"""Authenticated account workspace contracts, separate from synthetic demo records."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, JsonValue

from app.schemas.common import CompletenessStatus, Contract, CountryCode, VerificationStatus
from app.schemas.consent import PurposeConsent
from app.schemas.kb import SuggestedDocument, TaskConfig, VocabularyEntry
from app.schemas.profile import UserProfile


class AccountProfileState(Contract):
    profile: UserProfile | None = None
    draft: dict[str, JsonValue] = Field(default_factory=dict)
    completed: bool = False
    suggested_docs: list[dict[str, JsonValue]] = Field(default_factory=list)


class AccountConsentState(Contract):
    consents: list[PurposeConsent]
    mandatory_complete: bool


class BulkConsentDecision(Contract):
    process_documents: bool = False
    external_ai: bool = False
    retention: bool = False
    skip: bool = False


class AccountSetup(Contract):
    country_code: CountryCode
    country_label: str
    kb_version: str
    verification_status: VerificationStatus
    currency: str | None = None
    coverage_types: list[VocabularyEntry]
    document_types: list[VocabularyEntry]
    suggested_docs: list[SuggestedDocument]
    tasks: list[TaskConfig]


class AccountDocumentSummary(Contract):
    id: UUID
    kind: str
    country_code: CountryCode
    original_filename: str
    mime_type: str
    size_bytes: int
    status: str
    language: str | None
    injection_flag: bool
    original_file_status: Literal["RETAINED", "DELETED"]
    error_code: str | None
    created_at: datetime
    extracted_preview: str | None = None
    confidence: str | None = None
    version_detected: str | None = None


class AccountField(Contract):
    id: UUID
    document_id: UUID | None
    field_key: str
    value: JsonValue = None
    previous_value: JsonValue = None
    status: CompletenessStatus
    confidence: float | None
    source_page: int | None
    source_type: str
    confirmed_by_user: bool
    updated_at: datetime


class AccountDocumentDetail(AccountDocumentSummary):
    fields: list[AccountField]
    pages: list[dict[str, JsonValue]]
    benefits: list[dict[str, JsonValue]] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)
    waiting_periods: list[str] = Field(default_factory=list)
    claim_conditions: list[str] = Field(default_factory=list)


class AccountDocumentConfirm(Contract):
    document_kind: str | None = None
    status: Literal["VERIFIED", "NEEDS_REVIEW", "UNSUPPORTED"] = "VERIFIED"
    version_detected: Literal["NEW_POLICY", "UPDATE_TO_EXISTING", "DUPLICATE"] = "NEW_POLICY"
    fields: dict[str, JsonValue] = Field(default_factory=dict)
    benefits: list[dict[str, JsonValue]] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)
    waiting_periods: list[str] = Field(default_factory=list)
    claim_conditions: list[str] = Field(default_factory=list)


class AccountUploadResult(Contract):
    document_id: UUID
    status: str


class AccountFieldUpdate(Contract):
    value: JsonValue
    confirm: Literal[True]


class AccountManualField(Contract):
    field_key: str = Field(min_length=1, max_length=100)
    value: JsonValue
    confirm: Literal[True]


class AccountCompletenessItem(Contract):
    field_key: str
    label: str
    status: CompletenessStatus
    value: JsonValue = None
    source_type: str | None = None
    document_id: UUID | None = None
    source_page: int | None = None
    suggested_doc: str | None = None
    category: str | None = None
    details: str | None = None
    action_type: str | None = None
    action_url: str | None = None


class AccountVisaGap(Contract):
    status: Literal[
        "UNABLE_TO_DETERMINE",
        "NO_DATE_DIFFERENCE",
        "DATE_DIFFERENCE_DETECTED",
        "POTENTIAL_COVERAGE_GAP",
        "PASS",
        "GAP_FOUND",
        "NEEDS_VERIFICATION",
    ]
    requirement_status: Literal["VERIFIED", "NEEDS_VERIFICATION"] = "NEEDS_VERIFICATION"
    gap_days: int | None = None
    explanation: str
    source_url: str | None = None
    checked_at: str | None = None
    verification_status: VerificationStatus


class CompletenessTimelinePeriod(Contract):
    id: str
    label: str
    category: Literal["POLICY", "VISA", "GAP", "OTHER"] = "POLICY"
    provider: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    status: Literal["ACTIVE", "EXPIRING_SOON", "EXPIRED", "UNKNOWN", "GAP", "VALID"] = "VALID"
    is_verified: bool = True
    document_id: UUID | None = None
    source_page: int | None = None
    color: str = "blue"


class CompletenessAttentionItem(Contract):
    id: str
    title: str
    description: str
    category: Literal["PROFILE", "INSURANCE", "DOCUMENT"] = "PROFILE"
    severity: Literal["HIGH", "MEDIUM", "LOW"] = "MEDIUM"
    action_label: str
    action_url: str


class CompletenessMetrics(Contract):
    overall_pct: int
    profile_found: int
    profile_total: int
    insurance_found: int
    insurance_total: int
    documents_found: int
    documents_total: int


class AccountCompleteness(Contract):
    task_code: str
    task_label: str
    ready_count: int
    total_count: int
    ready_pct: int
    items: list[AccountCompletenessItem]
    visa_gap: AccountVisaGap | None = None
    coverage_continuity: AccountVisaGap | None = None
    kb_version: str
    verification_status: VerificationStatus
    metrics: CompletenessMetrics | None = None
    profile_items: list[AccountCompletenessItem] = Field(default_factory=list)
    insurance_items: list[AccountCompletenessItem] = Field(default_factory=list)
    document_items: list[AccountCompletenessItem] = Field(default_factory=list)
    timeline_items: list[CompletenessTimelinePeriod] = Field(default_factory=list)
    attention_items: list[CompletenessAttentionItem] = Field(default_factory=list)


class AccountInventory(Contract):
    document_count: int
    structured_field_count: int
    coverage_count: int
    claim_case_count: int
    action_count: int
    documents: list[AccountDocumentSummary]


class DeleteRequest(Contract):
    confirm: Literal["DELETE", "HAPUS"]


class Deleted(Contract):
    deleted: Literal[True]


class AccountPolicySummary(Contract):
    id: UUID
    document_id: UUID | None = None
    country_code: CountryCode
    kind: str
    provider: str | None = None
    plan_name: str | None = None
    policy_number_masked: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    coverage_limit: str | None = None
    deductible: str | None = None
    currency: str | None = "RMB"
    summary: str | None = None
    status: Literal["ACTIVE", "EXPIRING_SOON", "EXPIRED", "NOT_YET_ACTIVE", "UNKNOWN"] = "UNKNOWN"
    evidence_status: Literal["SELF_REPORTED", "NEEDS_REVIEW", "VERIFIED"]
    source_document_count: int = 0
    created_at: datetime


class AccountPolicyDetail(AccountPolicySummary):
    benefits: list[dict[str, JsonValue]] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)
    waiting_periods: list[str] = Field(default_factory=list)
    source_pages: list[int] = Field(default_factory=list)
    source_documents: list[dict[str, JsonValue]] = Field(default_factory=list)
    bpjs_coordination: str | None = None
    key_notes: list[str] = Field(default_factory=list)
    quick_actions: list[dict[str, str]] = Field(default_factory=list)
    important_dates: dict[str, JsonValue] = Field(default_factory=dict)


class AccountPolicyBenefitItem(Contract):
    name: str = Field(min_length=1, max_length=120)
    limit: str = Field(min_length=1, max_length=120)


class AccountPolicyCreate(Contract):
    provider: str = Field(min_length=1, max_length=200)
    plan_name: str = Field(min_length=1, max_length=200)
    policy_number: str | None = Field(default=None, max_length=100)
    policy_type: str = Field(min_length=1, max_length=100)
    start_date: str | None = Field(default=None, max_length=10)
    end_date: str | None = Field(default=None, max_length=10)
    status: Literal["ACTIVE", "EXPIRING_SOON", "EXPIRED", "NOT_YET_ACTIVE", "UNKNOWN"] | None = None
    coverage_limit: str | None = Field(default=None, max_length=100)
    deductible: str | None = Field(default=None, max_length=100)
    currency: str = Field(default="RMB", max_length=10)
    country_code: CountryCode = "CN"
    summary: str | None = Field(default=None, max_length=1000)
    benefits: list[AccountPolicyBenefitItem] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)


class AccountPolicyUpdate(Contract):
    provider: str | None = Field(default=None, max_length=200)
    plan_name: str | None = Field(default=None, max_length=200)
    policy_number: str | None = Field(default=None, max_length=100)
    policy_type: str | None = Field(default=None, max_length=100)
    start_date: str | None = Field(default=None, max_length=10)
    end_date: str | None = Field(default=None, max_length=10)
    status: Literal["ACTIVE", "EXPIRING_SOON", "EXPIRED", "NOT_YET_ACTIVE", "UNKNOWN"] | None = None
    coverage_limit: str | None = Field(default=None, max_length=100)
    deductible: str | None = Field(default=None, max_length=100)
    currency: str | None = Field(default=None, max_length=10)
    summary: str | None = Field(default=None, max_length=1000)
    benefits: list[AccountPolicyBenefitItem] | None = None
    exclusions: list[str] | None = None


class ClauseCitation(Contract):
    document_id: UUID | None = None
    filename: str | None = None
    page: int | None = None
    section: str | None = None
    clause_text: str
    relevance_score: float | None = None


class SignificantExclusion(Contract):
    category: str
    title: str
    explanation: str
    waiting_period_months: int | None = None
    clause: ClauseCitation | None = None
    is_verified: bool = False


class PolicyIntelligenceAnalysis(Contract):
    policy_id: UUID
    provider: str
    plan_name: str
    coverage_summary: str
    significant_exclusions: list[SignificantExclusion] = Field(default_factory=list)
    waiting_periods: list[dict[str, JsonValue]] = Field(default_factory=list)
    risk_assessment: list[str] = Field(default_factory=list)
    continuity_status: str
    grounded_evidence_count: int = 0


class FamilyMemberCreate(Contract):
    name: str = Field(min_length=1, max_length=200)
    relation: str = Field(min_length=1, max_length=50)
    birth_date: str | None = Field(default=None, max_length=10)
    consent_confirmed: Literal[True]


class FamilyMember(Contract):
    id: UUID
    name: str
    relation: str
    birth_date: str | None = None
    consent_at: datetime
    created_at: datetime
    active_coverage_count: int | None = None
