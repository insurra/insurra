"""Authenticated account workspace contracts, separate from synthetic demo records."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, JsonValue

from app.schemas.common import CompletenessStatus, Contract, CountryCode, VerificationStatus
from app.schemas.consent import PurposeConsent
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
    coverage_types: list[dict[str, JsonValue]]
    document_types: list[dict[str, JsonValue]]
    suggested_docs: list[dict[str, JsonValue]]
    tasks: list[dict[str, JsonValue]]


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
    policy_number_masked: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    status: Literal["ACTIVE", "EXPIRING_SOON", "EXPIRED", "UNKNOWN"] = "UNKNOWN"
    evidence_status: Literal["SELF_REPORTED", "NEEDS_REVIEW", "VERIFIED"]
    created_at: datetime


class AccountPolicyDetail(AccountPolicySummary):
    benefits: list[dict[str, JsonValue]] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)
    waiting_periods: list[str] = Field(default_factory=list)
    source_pages: list[int] = Field(default_factory=list)
    bpjs_coordination: str | None = None


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
