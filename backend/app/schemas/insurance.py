from datetime import date, datetime
from enum import StrEnum
from uuid import UUID

from pydantic import model_validator

from app.schemas.common import Contract, CountryCode, CurrencyCode, Money, VerificationStatus
from app.schemas.document import DocumentSummary, SourceEvidence


class CoverageStatus(StrEnum):
    COVERED = "COVERED"
    NOT_COVERED = "NOT_COVERED"
    UNKNOWN = "UNKNOWN"


class CoverageItem(Contract):
    coverage_code: str
    benefit_name: str
    coverage_status: CoverageStatus
    limit_amount: Money | None = None
    remaining_amount: Money | None = None
    currency: CurrencyCode | None = None
    evidence: SourceEvidence | None = None


class InsurancePolicy(Contract):
    id: UUID
    provider_name: str | None = None
    policy_name: str | None = None
    policy_type: str
    policy_number_masked: str | None = None
    coverage_start_date: date | None = None
    coverage_end_date: date | None = None
    coverage_items: list[CoverageItem]
    source_document_ids: list[UUID]
    verification_status: VerificationStatus

    @model_validator(mode="after")
    def valid_dates(self):
        if self.coverage_start_date and self.coverage_end_date:
            if self.coverage_end_date < self.coverage_start_date:
                raise ValueError("coverage_end_date must be on or after coverage_start_date")
        return self


class UnifiedInsuranceRecord(Contract):
    id: UUID
    profile_id: UUID
    country_code: CountryCode
    policies: list[InsurancePolicy]
    documents: list[DocumentSummary]
    updated_at: datetime
