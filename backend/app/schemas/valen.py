"""Additive presentation contracts for the shared account/demo product services."""

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.chat import AnswerCertainty
from app.schemas.common import Contract, CountryCode, CurrencyCode, Money


class NumericFact(Contract):
    category: str
    coverage_id: UUID | None = None
    policy_label: str | None = None
    currency: CurrencyCode | None = None
    limit: Money | None = None
    used: Money | None = None
    remaining: Money | None = None
    period_start: date | None = None
    period_end: date | None = None
    label: AnswerCertainty
    explanation: str
    over_limit: bool = False


class CoverageCard(Contract):
    id: UUID
    provider: str | None
    kind: str
    country_code: CountryCode
    start_date: date | None
    end_date: date | None
    active: bool
    expiring_30d: bool
    needs_verification: bool


class EmergencyInfo(Contract):
    phone_number: str | None = None
    label: str = "Darurat? Periksa layanan darurat setempat."
    source_url: str | None = None
    checked_at: date | None = None
    available: bool = False


class WorkspaceContext(Contract):
    first_name: str
    country_code: CountryCode
    country_label: str
    city: str | None
    occupation_label: str
    today: date
    timezone: str
    days_since_arrival: int | None = None
    arrival_date: date | None = None
    visa_expiry_date: date | None = None
    synthetic: bool
    process_documents: bool
    external_ai: bool
    retention: bool


class ServiceChoice(Contract):
    code: str
    label: str


class RecommendationDecision(Contract):
    rule_id: str = Field(min_length=1, max_length=100)
    subject: str = Field(min_length=1, max_length=100)
    decision: Literal["dismiss", "handled"]
    confirmed: bool = False


class SavedDecision(Contract):
    saved: Literal[True] = True


class AnswerFeedback(Contract):
    answer_id: UUID
    helpful: bool
    reason: Literal["unclear", "incorrect_source", "missing_detail", "other"] | None = None


class VerificationQuestion(Contract):
    code: str
    label: str
    steps: list[str]
    impact: str | None = None


class SourcePage(Contract):
    document_id: UUID
    page: int = Field(ge=1)
    text: str
