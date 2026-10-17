from datetime import date
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.common import Contract, CountryCode, VerificationStatus
from app.schemas.profile import Occupation, ResidenceContext


class CountryManifest(Contract):
    country_code: CountryCode
    label: str
    version: str
    checked_at: date | None
    sources: list[str]
    supported_features: list[str]
    verification_status: VerificationStatus


class Applicability(Contract):
    residence_context: list[ResidenceContext] = Field(default_factory=list)
    occupation: list[Occupation] = Field(default_factory=list)


class RuleParameters(Contract):
    policy_types: list[str]
    start_field: Literal["arrival_date"] = "arrival_date"
    end_field: Literal["visa_expiry_date"] = "visa_expiry_date"
    inclusive_end: Literal[True] = True


class CountryRule(Contract):
    rule_id: str
    kind: Literal["visa_coverage"]
    description: str
    applicability: Applicability
    parameters: RuleParameters
    source_url: str | None
    checked_at: date | None
    verification_status: VerificationStatus


class CoverageVocabulary(Contract):
    need_code: str
    label: str
    requirement_level: Literal["REQUIRED", "RECOMMENDED"]
    policy_types: list[str]
    verification_status: VerificationStatus


class PathwayConfig(Contract):
    pathway_code: str
    label: str
    description: str
    required_documents: list[str]
    estimated_out_of_pocket: None = None
    currency: str | None = None
    uncertainties: list[str]
    source_url: str | None
    verification_status: VerificationStatus


class EmergencyConfig(Contract):
    label: str
    phone_number: str | None
    source_url: str | None
    checked_at: date | None
    verification_status: VerificationStatus


class PathwaysResource(Contract):
    pathways: list[PathwayConfig]
    emergency: EmergencyConfig


class CountryKB(Contract):
    manifest: CountryManifest
    rules: list[CountryRule]
    coverage_needs: list[CoverageVocabulary]
    pathways: PathwaysResource
    glossary: dict[str, str]

    @model_validator(mode="after")
    def unique_rules(self):
        ids = [rule.rule_id for rule in self.rules]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate KB rule IDs")
        return self
