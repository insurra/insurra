from datetime import date
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

CountryCode = Annotated[str, Field(pattern=r"^[A-Z]{2}$")]
CurrencyCode = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]
Money = Annotated[str, Field(pattern=r"^\d+(\.\d+)?$")]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class CompletenessStatus(StrEnum):
    FOUND = "FOUND"
    UNVERIFIED = "UNVERIFIED"
    MISSING = "MISSING"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class VerificationStatus(StrEnum):
    VERIFIED = "VERIFIED"
    UNVERIFIED = "UNVERIFIED"


class EvidenceClass(StrEnum):
    """Real origin of a knowledge record. Only RETRIEVED_OFFICIAL is backed by a fetched artifact."""

    RETRIEVED_OFFICIAL = "RETRIEVED_OFFICIAL"
    MANUALLY_CURATED = "MANUALLY_CURATED"
    SYNTHETIC_FIXTURE = "SYNTHETIC_FIXTURE"
    PLACEHOLDER = "PLACEHOLDER"


class ApiError(Contract):
    code: str
    message: str
    details: dict[str, JsonValue] | None = None
    request_id: str


class Health(Contract):
    status: str
    version: str


class DateRange(Contract):
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def valid_range(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class RuleSource(Contract):
    country_code: CountryCode
    kb_version: str
    rule_id: str
    source_url: str | None = None
    checked_at: date | None = None
    verification_status: VerificationStatus
