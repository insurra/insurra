"""P0 wire contracts only; registering these does not implement product workflows."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, JsonValue, SecretStr, StrictBool, field_validator, model_validator

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
from app.schemas.valen import (
    CoverageCard,
    EmergencyInfo,
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


class ResetPasswordRequest(Contract):
    token: SecretStr = Field(min_length=1, max_length=4096)
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


class HomeSummary(Contract):
    active: int = Field(ge=0)
    expiring_30d: int = Field(ge=0)
    needs_verification: int = Field(ge=0)
    recommendations: list[Recommendation] = Field(max_length=3)
    context: WorkspaceContext | None = None
    coverages: list[CoverageCard] = Field(default_factory=list)
    emergency: EmergencyInfo = Field(default_factory=EmergencyInfo)
    warnings: list[str] = Field(default_factory=list)
    question_examples: list[str] = Field(default_factory=list, max_length=4)
    service_types: list[ServiceChoice] = Field(default_factory=list)
    triage_available: bool = False
    pathway_help: str = "Jelaskan kebutuhan layanan non-darurat."


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


class AnswerCitation(Contract):
    document_name: str | None = None
    doc: UUID
    page: int = Field(ge=1)
    quote: str = Field(min_length=1)


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
    service_type: ShortCode
    city: str | None = Field(default=None, max_length=100)
    timeframe: Literal["today", "this_week", "unknown"] = "unknown"

    @field_validator("complaint", "service_type")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("Must not be blank")
        return value.strip()


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


class PathwayComparison(Contract):
    paths: list[PathwayOption] = Field(max_length=3)
    comparison_id: UUID | None = None
    uncertainties: list[VerificationQuestion] = Field(default_factory=list, max_length=5)
    warnings: list[str] = Field(default_factory=list)
    context_country_code: CountryCode | None = None


class TriageRequest(Contract):
    text: str = Field(min_length=1, max_length=500)


class TriageMatch(Contract):
    id: str
    kb_version: str


class TriageResult(Contract):
    red_flag: bool
    matched: list[TriageMatch]


class ClaimCaseStatus(StrEnum):
    DRAFT = "DRAFT"
    READY_FOR_SUBMISSION = "READY_FOR_SUBMISSION"
    SUBMITTED = "SUBMITTED"
    PROCESSING = "PROCESSING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
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


class ActionExecutionRequest(Contract):
    approved_payload_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class SandboxAttachment(Contract):
    document_id: UUID
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class SandboxClaimRequest(ActionExecutionRequest):
    action_id: UUID
    claim_case_id: UUID
    attachments: list[SandboxAttachment]


class SandboxClaimResponse(Contract):
    claim_ref: str
    status: str
    sandbox: Literal[True]
