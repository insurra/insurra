"""P0 wire contracts only; registering these does not implement product workflows."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, JsonValue, SecretStr, StrictBool, field_validator, model_validator

from app.agent.insights import ProtectionInsight
from app.schemas.actor import Actor, ActorType
from app.schemas.chat import AnswerCertainty
from app.schemas.claim import ChecklistStatus
from app.schemas.common import (
    ApiError,
    CompletenessStatus,
    Contract,
    CountryCode,
    CurrencyCode,
    Money,
    RuleSource,
)
from app.schemas.document import ProcessingStatus, SourceEvidence
from app.schemas.workspace import (
    CoverageCard,
    EmergencyInfo,
    HomeActivityItem,
    HomeAttention,
    NumericFact,
    ServiceChoice,
    VerificationQuestion,
    WorkspaceContext,
)

ShortCode = Annotated[str, Field(min_length=1, max_length=100)]
Email = Annotated[str, Field(max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")]


class PageMeta(Contract):
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)
    total: int = Field(ge=0)


class LoginRequest(Contract):
    email: Email
    password: SecretStr = Field(min_length=1, max_length=128)


class RegisterRequest(LoginRequest):
    accepted_terms: Literal[True]
    password_confirmation: SecretStr = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def password_requirements(self):
        value = self.password.get_secret_value()
        if value != self.password_confirmation.get_secret_value():
            raise ValueError("Password confirmation must match")
        if (
            len(value) < 8
            or not any(c.isalpha() for c in value)
            or not any(c.isdigit() for c in value)
        ):
            raise ValueError("Password requires at least 8 characters, letters and digits")
        return self


class EmailRequest(Contract):
    email: Email


class VerificationRequest(Contract):
    token: SecretStr = Field(min_length=1, max_length=4096)
    email: Email | None = None


class ResetPasswordRequest(Contract):
    token: SecretStr = Field(min_length=1, max_length=4096)
    email: Email | None = None
    password: SecretStr = Field(min_length=1, max_length=128)
    password_confirmation: SecretStr = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def password_requirements(self):
        value = self.password.get_secret_value()
        if value != self.password_confirmation.get_secret_value():
            raise ValueError("Password confirmation must match")
        if (
            len(value) < 8
            or not any(c.isalpha() for c in value)
            or not any(c.isdigit() for c in value)
        ):
            raise ValueError("Password requires at least 8 characters, letters and digits")
        return self


class AuthMessage(Contract):
    message: str


class SupabaseAuthRequest(Contract):
    access_token: SecretStr | None = None
    code: str | None = None

    @model_validator(mode="after")
    def require_token_or_code(self):
        if not self.access_token and not self.code:
            raise ValueError("Either access_token or code is required")
        return self


class AuthCapabilities(Contract):
    email_delivery: bool
    google_oauth: bool


class AccountSummary(Contract):
    id: UUID
    email: Email | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    email_verified: bool
    actor: Actor
    consent_decided: bool = False
    profile_completed: bool = False

    @model_validator(mode="after")
    def account_actor(self):
        if (
            self.actor.actor_type != ActorType.AUTHENTICATED_ACCOUNT
            or self.actor.account_id != self.id
        ):
            raise ValueError("Account summaries require the matching authenticated-account actor")
        return self


class AuthSession(Contract):
    account: AccountSummary
    access_token: str
    expires_at: datetime


class FieldReviewRequest(Contract):
    value: JsonValue = None
    confirm: Literal[True]


class ReviewedField(Contract):
    id: UUID
    document_id: UUID
    field_key: str
    value: JsonValue = None
    previous_value: JsonValue = None
    source_page: int | None = Field(default=None, ge=1)
    confidence: float | None = Field(default=None, ge=0, le=1)
    status: CompletenessStatus
    confirmed_by_user: bool
    source_evidence: SourceEvidence | None = None
    updated_at: datetime

    @model_validator(mode="after")
    def found_requires_verified_value(self):
        if self.status == CompletenessStatus.FOUND:
            if self.value is None:
                raise ValueError("FOUND requires a value")
            if not self.confirmed_by_user and (
                self.confidence is None or self.confidence < 0.8 or self.source_evidence is None
            ):
                raise ValueError("FOUND requires user confirmation or high-confidence evidence")
        return self


class DocumentUploadAccepted(Contract):
    document_id: UUID
    status: ProcessingStatus


class DocumentDetail(Contract):
    id: UUID
    status: ProcessingStatus
    kind: str
    country_code: CountryCode
    injection_flag: bool
    fields: list[ReviewedField]


class DeleteConfirmation(Contract):
    confirm: Literal["HAPUS"]


class DeletionResult(Contract):
    deleted: Literal[True]


class InventoryDocument(Contract):
    document_id: UUID
    original_filename: str
    kind: str
    size_bytes: int | None = Field(default=None, ge=0)
    uploaded_at: datetime
    original_file_status: Literal["RETAINED", "DELETED", "NOT_STORED"]


class DataInventory(Contract):
    document_count: int = Field(ge=0)
    structured_field_count: int = Field(ge=0)
    claim_case_count: int = Field(ge=0)
    action_count: int = Field(ge=0)
    documents: list[InventoryDocument]


class CompletenessCheckItem(Contract):
    field_key: str
    status: CompletenessStatus
    suggested_doc: str | None = None
    source_evidence: SourceEvidence | None = None
    rule_source: RuleSource | None = None


class CompletenessReport(Contract):
    ready_pct: int = Field(ge=0, le=100)
    items: list[CompletenessCheckItem]


class Recommendation(Contract):
    rule_id: str
    title: str
    explanation: str
    source: RuleSource | None = None
    priority: int = 0
    subject: str = "context"
    action_url: str = "/documents"
    dismissible: bool = True
    handled: bool = False
    visa_related: bool = False
    action_type: str | None = None


class PrioritizedAction(Contract):
    id: str
    index: int = 1
    title: str
    description: str
    priority: Literal["HIGH", "MEDIUM", "LOW", "UPCOMING"] = "HIGH"
    priority_label: str = "High Priority"
    category: str = "general"
    icon: str = "shield"
    tags: list[str] = Field(default_factory=list)
    deep_link: str = "/protection"
    action_label: str = "View Details"
    action_type: str | None = None
    source_finding_id: str | None = None
    dismissible: bool = True
    handled: bool = False


class HomeAssessmentSummary(Contract):
    overall_status: Literal["ON_TRACK", "ATTENTION_NEEDED", "NEEDS_VERIFICATION"] = "ON_TRACK"
    headline: str = "You're on track!"
    description: str = "You're covered in most key areas. A few areas may need attention based on your current situation."
    last_assessed_at: str | None = None
    score_ratio: str = "3/6"
    score_label: str = "Needs attention"
    covered_count: int = 3
    partially_covered_count: int = 1
    not_covered_count: int = 1
    unknown_count: int = 1
    not_applicable_count: int = 0


class HomeProtectionAreaItem(Contract):
    code: str
    title: str
    icon: str
    status: Literal["COVERED", "PARTIALLY_COVERED", "NOT_COVERED", "UNKNOWN", "NOT_APPLICABLE"]
    status_label: str


class ContinuityGapItem(Contract):
    id: str
    gap_type: Literal["BETWEEN_POLICIES", "STAY_UNCOVERED", "SUCCESSOR_MISSING"]
    category: str
    start_date: str
    end_date: str
    days: int
    severity: Literal["HIGH", "MEDIUM", "LOW"]
    description: str


class MonitoredPolicyItem(Contract):
    policy_ref: str
    provider: str
    category: str
    end_date: str | None = None
    days_left: int | None = None
    status: Literal[
        "ACTIVE_GOOD_STANDING",
        "UPCOMING_EXPIRY",
        "CONFIRMED_CURRENT_LAPSE",
        "HISTORICAL_DOCUMENT_EXPIRED",
        "UNDATED",
    ]
    status_label: str
    is_historical: bool = False
    action_prepared: bool = False


class AntiLapseAgentStatus(Contract):
    agent_id: str = "anti_lapse_sentinel"
    agent_name: str = "Proactive Renewal & Anti-Lapse Agent"
    status: Literal["ACTIVE_MONITORING", "ACTION_PREPARED", "ATTENTION_REQUIRED", "IDLE"]
    headline: str
    description: str
    last_scanned_at: str
    timezone: str
    scan_offsets: list[int] = Field(default_factory=lambda: [30, 7, 1])
    policies_scanned: int = 0
    active_monitored_policies: list[MonitoredPolicyItem] = Field(default_factory=list)
    continuity_gaps: list[ContinuityGapItem] = Field(default_factory=list)
    prepared_actions_count: int = 0
    reminders_count: int = 0
    reasoning_trail: list[str] = Field(default_factory=list)
    active_action_id: str | None = None
    active_action_ref: str | None = None
    active_action_title: str | None = None


class HomeSummary(Contract):
    active: int = Field(ge=0)
    expiring_30d: int = Field(ge=0)
    needs_verification: int = Field(ge=0)
    recommendations: list[Recommendation] = Field(max_length=3)
    insights: list[ProtectionInsight] = Field(default_factory=list, max_length=3)
    attention: HomeAttention | None = None
    recent_activity: list[HomeActivityItem] = Field(default_factory=list, max_length=5)
    context: WorkspaceContext | None = None
    coverages: list[CoverageCard] = Field(default_factory=list)
    emergency: EmergencyInfo = Field(default_factory=EmergencyInfo)
    warnings: list[str] = Field(default_factory=list)
    question_examples: list[str] = Field(default_factory=list, max_length=4)
    service_types: list[ServiceChoice] = Field(default_factory=list)
    triage_available: bool = False
    pathway_help: str = "Describe your non-emergency care needs."
    prioritized_actions: list[PrioritizedAction] = Field(default_factory=list, max_length=3)
    assessment_summary: HomeAssessmentSummary | None = None
    protection_areas: list[HomeProtectionAreaItem] = Field(default_factory=list)
    anti_lapse_agent: AntiLapseAgentStatus | None = None


class AskRequest(Contract):
    question: str = Field(min_length=1, max_length=500)
    coverage_id: UUID | None = None
    chat_session_id: UUID | None = None

    @field_validator("question")
    @classmethod
    def meaningful_question(cls, value):
        if not value.strip():
            raise ValueError("Question must not be blank")
        return value.strip()


AskIntent = Literal[
    "POLICY_QUESTION",
    "COVERAGE_STATUS",
    "CLAIM_HELP",
    "REMINDER_REQUEST",
    "SERVICING_REQUEST",
    "CARE_NAVIGATION",
    "OUT_OF_SCOPE",
    "MEDICAL_ADVICE",
]


class ToolStep(Contract):
    tool: str
    status: Literal["COMPLETED", "SKIPPED", "PROPOSED"] = "COMPLETED"
    summary: str


class ActionProposal(Contract):
    proposal_id: str
    action_type: str
    title: str
    summary: str
    target_entity: str | None = None
    requires_approval: Literal[True] = True


class PreparedProposalAction(Contract):
    action_id: UUID
    status: str = "AWAITING_APPROVAL"
    action_type: str


class CoverageDetailItem(Contract):
    status: Literal["COVERED", "NOT_COVERED", "LIMIT", "CONDITION", "INFO"]
    text: str


class PolicyUsedItem(Contract):
    policy_id: str | None = None
    provider: str
    plan_name: str
    status: str = "Active"
    verification_status: str = "Verified"
    date_range: str | None = None
    logo_key: str | None = None


class ReferencedSourceItem(Contract):
    doc_id: str | None = None
    document_name: str
    organization: str | None = None
    location: str
    page: int = 1
    quote: str | None = None


class SuggestedNextStepItem(Contract):
    title: str
    description: str
    action_type: str = "navigate"
    action_url: str
    icon_type: str = "shield"


class RelatedSituationLink(Contract):
    title: str
    url: str
    icon_type: str = "shield"
    badge: str | None = None


class AnswerCitation(Contract):
    document_name: str | None = None
    doc: UUID
    page: int = Field(ge=1)
    quote: str = Field(min_length=1)
    language: str | None = None
    explanation_label: str | None = None


class AnswerPoint(Contract):
    text: str
    label: AnswerCertainty
    citations: list[AnswerCitation]

    @model_validator(mode="after")
    def document_label_requires_evidence(self):
        if self.label == AnswerCertainty.FROM_DOCUMENT and not self.citations:
            raise ValueError("FROM_DOCUMENT requires source citations")
        return self


class AskAnswer(Contract):
    answer_points: list[AnswerPoint] = Field(max_length=5)
    warnings: list[str] = Field(default_factory=list)
    numeric_facts: list[NumericFact] = Field(default_factory=list, max_length=5)
    verification_steps: list[str] = Field(default_factory=list)
    context_country_code: CountryCode | None = None
    disposition: Literal["answered", "no_match", "declined"] = "answered"
    chat_session_id: UUID | None = None
    answer_id: UUID | None = None
    intent: AskIntent = "POLICY_QUESTION"
    tool_steps: list[ToolStep] = Field(default_factory=list)
    proposals: list[ActionProposal] = Field(default_factory=list)
    answer_markdown: str | None = None
    key_coverage_details: list[CoverageDetailItem] = Field(default_factory=list)
    policies_used: list[PolicyUsedItem] = Field(default_factory=list)
    sources_referenced: list[ReferencedSourceItem] = Field(default_factory=list)
    suggested_next_steps: list[SuggestedNextStepItem] = Field(default_factory=list)
    related_links: list[RelatedSituationLink] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)
    evidence_verification_banner: str | None = None


class ChatTurn(Contract):
    id: UUID
    question: str
    answer: AskAnswer


class ChatHistory(Contract):
    chat_session_id: UUID
    turns: list[ChatTurn] = Field(max_length=10)


class EmergencyRedirect(Contract):
    redirect: Literal["emergency"]


class AnswerPointEvent(Contract):
    event: Literal["answer_point"]
    data: AnswerPoint


class AnswerCompleteEvent(Contract):
    event: Literal["complete"]
    data: AskAnswer


class EmergencyRedirectEvent(Contract):
    event: Literal["redirect"]
    data: EmergencyRedirect


class StreamErrorEvent(Contract):
    event: Literal["error"]
    data: ApiError


class ProgressData(Contract):
    stage: Literal["retrieving", "validating"]


class AskProgressEvent(Contract):
    event: Literal["progress"]
    data: ProgressData


AskStreamEvent = Annotated[
    AnswerPointEvent
    | AnswerCompleteEvent
    | EmergencyRedirectEvent
    | StreamErrorEvent
    | AskProgressEvent,
    Field(discriminator="event"),
]


class PathwayComparisonRequest(Contract):
    complaint: str = Field(min_length=1, max_length=300)
    service_type: ShortCode | None = Field(default=None)
    city: str | None = Field(default=None, max_length=100)
    timeframe: Literal["today", "this_week", "unknown"] = "unknown"

    @field_validator("complaint", "service_type")
    @classmethod
    def not_blank(cls, value):
        if value is not None and not value.strip():
            raise ValueError("Must not be blank")
        return value.strip() if value is not None else None


class MoneyEstimate(Contract):
    minimum: Money
    maximum: Money
    currency: CurrencyCode
    source_reference: RuleSource
    synthetic: bool = False

    @model_validator(mode="after")
    def valid_amount_range(self):
        from decimal import Decimal

        if Decimal(self.maximum) < Decimal(self.minimum):
            raise ValueError("maximum must be at least minimum")
        return self


class PathwayOption(Contract):
    pathway_code: str
    name: str
    coverage_id: UUID | None = None
    steps: list[str]
    requirements: list[str]
    est_out_of_pocket: MoneyEstimate | None = None
    docs: list[str]
    uncertainties: list[str]
    sources: list[RuleSource]
    description: str = ""
    coverage_label: str | None = None
    coverage_status: Literal["MATCHED", "NEEDS_CHECK"] = "NEEDS_CHECK"
    emergency: bool = False
    best_for_priority: bool = False
    priority_reason: str | None = None
    direct_billing: bool | None = None
    native_name: str | None = None
    distance_km: float | None = None
    travel_time_min: int | None = None
    language_support: str | None = None
    wait_time_estimate: str | None = None
    tier: str | None = None
    image_url: str | None = None
    in_network: bool | None = None
    provider_id: str | None = None
    facility_address: str | None = None
    facility_phone: str | None = None
    highlights: list[str] = Field(default_factory=list)
    cautions: list[str] = Field(default_factory=list)


class PathwayComparison(Contract):
    paths: list[PathwayOption] = Field(default_factory=list, max_length=10)
    comparison_id: UUID | None = None
    uncertainties: list[VerificationQuestion] = Field(default_factory=list, max_length=5)
    warnings: list[str] = Field(default_factory=list)
    context_country_code: CountryCode | None = None
    ai_guidance: str | None = None
    inferred_need: str | None = None


class TriageRequest(Contract):
    text: str = Field(min_length=1, max_length=500)
    country_code: CountryCode | None = None


class TriageMatch(Contract):
    id: str
    kb_version: str
    category: Literal["MEDICAL", "SELF_HARM"]
    source_url: str


class TriageResult(Contract):
    red_flag: bool
    matched: list[TriageMatch]
    safety_flows: list[Literal["EMERGENCY_MEDICAL", "SELF_HARM_SUPPORT"]] = Field(
        default_factory=list
    )
    screening_complete: Literal[False] = False


class ClaimCaseStatus(StrEnum):
    DRAFT = "DRAFT"
    NEEDS_EVIDENCE = "NEEDS_EVIDENCE"
    READY_FOR_REVIEW = "READY_FOR_REVIEW"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    READY_FOR_SUBMISSION = "READY_FOR_SUBMISSION"
    SUBMITTED = "SUBMITTED"
    SUBMITTED_SANDBOX = "SUBMITTED_SANDBOX"
    PROCESSING = "PROCESSING"
    ADDITIONAL_INFORMATION_REQUIRED = "ADDITIONAL_INFORMATION_REQUIRED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    SANDBOX_APPROVED = "SANDBOX_APPROVED"
    SANDBOX_REJECTED = "SANDBOX_REJECTED"
    CANCELLED = "CANCELLED"


class ClaimCaseCreate(Contract):
    path: ShortCode
    coverage_id: UUID
    comparison_id: UUID | None = None


class ClaimCaseCreated(Contract):
    claim_case_id: UUID


class ClaimCase(ClaimCaseCreate):
    id: UUID
    country_code: CountryCode
    status: ClaimCaseStatus
    claim_ref: str | None = None
    sandbox_status: str | None = None
    last_checked_at: datetime | None = None
    monitoring_state: Literal["NOT_CONFIGURED", "ACTIVE", "PAUSED", "FAILED"] | None = None
    created_at: datetime


class ClaimCaseEvent(Contract):
    id: UUID
    event_type: str = Field(max_length=50)
    status_snapshot: ClaimCaseStatus
    created_at: datetime


class CaseChecklistItem(Contract):
    item_key: str
    required: bool
    rule_source: RuleSource | SourceEvidence | None
    status: ChecklistStatus
    document_id: UUID | None = None


class ConsistencyCheck(Contract):
    check_code: str
    status: Literal["MATCH", "MISMATCH", "NEEDS_CHECK", "USER_CONFIRMED"]
    sources: list[SourceEvidence]
    user_note: str | None = None


class ClaimCaseDetail(Contract):
    case: ClaimCase
    checklist: list[CaseChecklistItem]
    consistency_checks: list[ConsistencyCheck]
    timeline: list[ClaimCaseEvent] = Field(default_factory=list)


class ClaimCasePage(Contract):
    items: list[ClaimCaseDetail]
    pagination: PageMeta


class EvidenceMatchResult(Contract):
    matched_items: list[CaseChecklistItem]


class ClaimDraftAction(Contract):
    action_id: UUID
    status: Literal["pending"]


class ActionDecisionRequest(Contract):
    edited_payload: dict[str, JsonValue] | None = None
    reason: str | None = Field(default=None, max_length=500)
    confirmed: StrictBool = False
    expected_payload_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class ActionExecutionRequest(Contract):
    approved_payload_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class SandboxAttachment(Contract):
    document_id: UUID
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ClaimSubmissionPayload(Contract):
    claim_case_id: UUID
    attachments: list[SandboxAttachment]


class SandboxClaimRequest(ActionExecutionRequest):
    action_id: UUID
    claim_case_id: UUID
    attachments: list[SandboxAttachment]


class SandboxClaimResponse(Contract):
    claim_ref: str
    status: str
    sandbox: Literal[True] = True
    action_id: UUID | None = None
    claim_case_id: UUID | None = None
    claim_case_status: str = "SUBMITTED"
    claim_case_status_label: str = "Diajukan"
    submitted_at: datetime | None = None
    provider_label: str = "Sandbox – bukan penyedia nyata"
    status_timeline: list[dict[str, JsonValue]] = Field(default_factory=list)
    rejection_reason: str | None = None


class SandboxLogEntry(Contract):
    timestamp: datetime
    action_id: UUID
    claim_case_id: UUID | None = None
    claim_ref: str
    sandbox: Literal[True] = True
    environment_label: str = "SANDBOX – Bukan penyedia nyata"
    tool_called: str = "submit_claim_sandbox"
    outcome: Literal["SUCCESS", "VALIDATION_FAILED"] = "SUCCESS"
    initial_status: str
    case_status: str
    case_status_label: str
    request_summary: dict[str, JsonValue] = Field(default_factory=dict)
    response_summary: dict[str, JsonValue] = Field(default_factory=dict)
