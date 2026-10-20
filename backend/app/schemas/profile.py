from datetime import date, datetime
from enum import StrEnum
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.schemas.common import Contract, CountryCode, CurrencyCode


class ResidenceContext(StrEnum):
    DOMESTIC = "DOMESTIC"
    ABROAD = "ABROAD"


class Occupation(StrEnum):
    STUDENT = "STUDENT"
    EMPLOYEE = "EMPLOYEE"
    OTHER = "OTHER"


class Situation(StrEnum):
    STUDENT = "STUDENT"
    EMPLOYEE = "EMPLOYEE"
    SELF_EMPLOYED = "SELF_EMPLOYED"
    OTHER = "OTHER"


class Goal(StrEnum):
    UNDERSTAND_COVERAGE = "UNDERSTAND_COVERAGE"
    DISCOVER_GAPS = "DISCOVER_GAPS"
    PREPARE_CLAIM = "PREPARE_CLAIM"
    FIND_CARE = "FIND_CARE"
    TRACK_RENEWALS = "TRACK_RENEWALS"
    COMPARE_OPTIONS = "COMPARE_OPTIONS"
    MANAGE_FAMILY = "MANAGE_FAMILY"


class ProtectionScope(StrEnum):
    SELF = "SELF"
    SPOUSE = "SPOUSE"
    CHILDREN = "CHILDREN"
    DEPENDENTS = "DEPENDENTS"
    HOUSEHOLD = "HOUSEHOLD"


class LifeContext(StrEnum):
    STUDY = "STUDY"
    WORK = "WORK"
    LIVING = "LIVING"
    TRAVEL = "TRAVEL"
    OTHER = "OTHER"


class AgeRange(StrEnum):
    UNDER_18 = "UNDER_18"
    AGE_18_24 = "18_24"
    AGE_25_34 = "25_34"
    AGE_35_44 = "35_44"
    AGE_45_54 = "45_54"
    AGE_55_64 = "55_64"
    AGE_65_PLUS = "65_PLUS"


class AnswerState(StrEnum):
    YES = "YES"
    NO = "NO"
    UNKNOWN = "UNKNOWN"


class ExistingInsuranceState(StrEnum):
    YES = "YES"
    NO = "NO"
    NOT_SURE = "NOT_SURE"


class AdditionalCoverageIntent(StrEnum):
    YES = "YES"
    NO = "NO"
    UNSURE = "UNSURE"


class DecisionPreference(StrEnum):
    LOWER_PREMIUM = "LOWER_PREMIUM"
    WIDER_BENEFITS = "WIDER_BENEFITS"
    FLEXIBILITY = "FLEXIBILITY"


SITUATION_OCCUPATION = {
    Situation.STUDENT: Occupation.STUDENT,
    Situation.EMPLOYEE: Occupation.EMPLOYEE,
    Situation.SELF_EMPLOYED: Occupation.OTHER,
    Situation.OTHER: Occupation.OTHER,
}

# Country-bound metadata that must not silently carry over to a new residence country.
COUNTRY_BOUND_FIELDS = (
    "city",
    "timezone",
    "institution_name",
    "arrival_date",
    "visa_expiry_date",
    "budget_range",
    "currency",
    "permit_end_date",
    "study_start_date",
    "study_end_date",
)


def non_nullable_update_schema(schema: dict) -> None:
    """Omission is supported, but explicit null is rejected by the field validator."""
    schema.pop("default", None)
    variants = [item for item in schema.pop("anyOf") if item.get("type") != "null"]
    schema.update(variants[0])


class ProfileData(Contract):
    display_name: str = Field(min_length=1, max_length=100)
    residence_context: ResidenceContext
    country_code: CountryCode
    city: str | None = Field(default=None, max_length=100)
    occupation: Occupation
    timezone: str | None = Field(default=None, max_length=100)
    employment_status: str | None = Field(default=None, max_length=100)
    institution_name: str | None = Field(default=None, max_length=200)
    dependents: list[str] = Field(default_factory=list, max_length=6)
    owned_coverage: list[str] = Field(default_factory=list, max_length=20)
    priorities: list[str] = Field(default_factory=list, max_length=2)
    budget_range: str | None = Field(default=None, max_length=100)
    currency: CurrencyCode | None = None
    arrival_date: date | None = None
    visa_expiry_date: date | None = None
    nationality: CountryCode | None = None
    situation: Situation | None = None
    study_start_date: date | None = None
    study_end_date: date | None = None
    permit_end_date: date | None = None
    employer_name: str | None = Field(default=None, max_length=200)
    goals: list[Goal] = Field(default_factory=list, max_length=7)
    protection_scope: list[ProtectionScope] = Field(default_factory=list, max_length=5)
    life_context: LifeContext | None = None
    age_range: AgeRange | None = None
    visa_status: str | None = Field(default=None, max_length=100)
    employment_type: str | None = Field(default=None, max_length=50)
    employer_coverage_eligibility: AnswerState | None = None
    has_dependents: bool | None = None
    dependent_age_groups: list[str] = Field(default_factory=list, max_length=3)
    dependent_insurance_status: AnswerState | None = None
    financial_responsibilities: list[str] = Field(default_factory=list, max_length=5)
    has_existing_insurance: ExistingInsuranceState | None = None
    insurance_sources: list[str] = Field(default_factory=list, max_length=6)
    insurer_name: str | None = Field(default=None, max_length=200)
    policy_expiry_known: bool | None = None
    policy_expiry_date: date | None = None
    policy_documents_available: bool | None = None
    primary_concern: str | None = Field(default=None, max_length=100)
    willing_additional_coverage: AdditionalCoverageIntent | None = None
    decision_preference: DecisionPreference | None = None

    @model_validator(mode="before")
    @classmethod
    def derive_compatible_fields(cls, data):
        if not isinstance(data, dict):
            return data
        data = dict(data)
        situation = data.get("situation")
        if situation is not None and data.get("occupation") is None:
            try:
                data["occupation"] = SITUATION_OCCUPATION[Situation(situation)].value
            except ValueError:
                pass  # Field validation reports the invalid situation.
        if data.get("permit_end_date") is not None and data.get("visa_expiry_date") is None:
            data["visa_expiry_date"] = data["permit_end_date"]
        if "has_dependents" not in data and "dependents" in data:
            data["has_dependents"] = bool(data.get("dependents"))
        if "has_existing_insurance" not in data and "owned_coverage" in data:
            if data.get("owned_coverage"):
                data["has_existing_insurance"] = ExistingInsuranceState.YES.value
        return data

    @field_validator("goals", "protection_scope")
    @classmethod
    def unique_values(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Values must be unique")
        return value

    @model_validator(mode="after")
    def valid_dates(self):
        if self.situation and self.occupation:
            if SITUATION_OCCUPATION[self.situation] != self.occupation:
                raise ValueError("situation is not compatible with occupation")
        if self.study_start_date and self.study_end_date:
            if self.study_end_date < self.study_start_date:
                raise ValueError("study_end_date must be on or after study_start_date")
        if self.timezone:
            from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

            try:
                ZoneInfo(self.timezone)
            except ZoneInfoNotFoundError as exc:
                raise ValueError("Unknown IANA timezone") from exc
        if self.arrival_date and self.visa_expiry_date:
            if self.visa_expiry_date < self.arrival_date:
                raise ValueError("visa_expiry_date must be on or after arrival_date")
        if self.policy_expiry_known is False and self.policy_expiry_date is not None:
            raise ValueError("policy_expiry_date requires policy_expiry_known")
        if self.has_dependents is not True and (self.dependents or self.dependent_age_groups):
            raise ValueError("dependent details require has_dependents")
        return self


class ProfileUpdate(ProfileData):
    """Partial profile update; country switches clear omitted country-bound metadata."""

    display_name: str | None = Field(
        default=None, min_length=1, max_length=100, json_schema_extra=non_nullable_update_schema
    )
    residence_context: ResidenceContext | None = Field(
        default=None, json_schema_extra=non_nullable_update_schema
    )
    country_code: CountryCode | None = Field(
        default=None, json_schema_extra=non_nullable_update_schema
    )
    occupation: Occupation | None = Field(
        default=None, json_schema_extra=non_nullable_update_schema
    )

    @field_validator("display_name", "residence_context", "country_code", "occupation")
    @classmethod
    def non_nullable_core(cls, value):
        if value is None:
            raise ValueError("Core profile fields cannot be cleared")
        return value


class UserProfile(ProfileData):
    id: UUID
    created_at: datetime
    updated_at: datetime
