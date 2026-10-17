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

    @model_validator(mode="after")
    def valid_dates(self):
        if self.timezone:
            from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

            try:
                ZoneInfo(self.timezone)
            except ZoneInfoNotFoundError as exc:
                raise ValueError("Unknown IANA timezone") from exc
        if self.arrival_date and self.visa_expiry_date:
            if self.visa_expiry_date < self.arrival_date:
                raise ValueError("visa_expiry_date must be on or after arrival_date")
        return self


class ProfileUpdate(ProfileData):
    """Merge supplied fields into the actor's profile; never reset omitted fields."""

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
