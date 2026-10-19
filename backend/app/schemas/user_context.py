from enum import StrEnum

from pydantic import Field

from app.schemas.common import Contract, CountryCode, CurrencyCode
from app.schemas.profile import Goal, Situation


class ContextMode(StrEnum):
    ACCOUNT = "ACCOUNT"
    DEMO = "DEMO"


class UserContext(Contract):
    """Server-authoritative context for either an account or a demo session."""

    mode: ContextMode
    is_synthetic: bool
    persona_id: str | None = None
    display_name: str | None = None
    email: str | None = None
    email_verified: bool = False
    residence_country: CountryCode | None = None
    city: str | None = None
    currency: CurrencyCode | None = None
    situation: Situation | None = None
    onboarding_completed: bool
    declared_insurance_categories: list[str] = Field(default_factory=list)
    goals: list[Goal] = Field(default_factory=list)
    # Setup state stays separate: declaring insurance never implies verified coverage.
    profile_completed: bool
    insurance_declared: bool
    documents_uploaded: int = Field(ge=0)
    fields_extracted: int = Field(ge=0)
    fields_reviewed: int = Field(ge=0)
    coverage_verified: bool
