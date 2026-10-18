from datetime import date
from typing import Generic, Literal, TypeVar

from pydantic import Field, JsonValue, model_validator

from app.schemas.common import Contract, CountryCode, CurrencyCode, Money, VerificationStatus
from app.schemas.profile import Occupation, ResidenceContext


class CountryManifest(Contract):
    country_code: CountryCode
    schema_version: Literal["1.5"] = "1.5"
    label: str
    version: str
    checked_at: date | None
    sources: list[str]
    supported_features: list[str]
    verification_status: VerificationStatus
    default_timezone: str = "UTC"
    city_timezones: dict[str, str] = Field(default_factory=dict)
    official_source_hosts: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def verified_manifest_requires_sources(self):
        if self.verification_status == VerificationStatus.VERIFIED and (
            not self.sources or not self.checked_at
        ):
            raise ValueError("Verified manifest requires checked sources")
        return self


class Applicability(Contract):
    residence_context: list[ResidenceContext] = Field(default_factory=list)
    occupation: list[Occupation] = Field(default_factory=list)
    has_dependents: bool | None = None
    requires_visa_context: bool | None = None


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

    source_url: str | None = None
    checked_at: date | None = None
    applicability: Applicability = Field(default_factory=Applicability)
    benefit_categories: list[str] = Field(default_factory=list)
    explanation: str = "Verifikasi kebutuhan sesuai situasi Anda."
    verification_steps: list[str] = Field(default_factory=list)
    task_code: str | None = None

    @model_validator(mode="after")
    def required_needs_verified_source(self):
        if self.requirement_level == "REQUIRED" and (
            self.verification_status != VerificationStatus.VERIFIED
            or not self.source_url
            or not self.checked_at
        ):
            raise ValueError("Required coverage needs a verified checked source")
        return self


class ReferenceTariff(Contract):
    minimum: Money
    maximum: Money
    currency: CurrencyCode
    source_url: str
    checked_at: date
    verification_status: VerificationStatus
    synthetic: bool = False


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
    checked_at: date | None = None
    service_types: list[str] = Field(default_factory=list)
    policy_types: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list, max_length=5)
    requirements: list[str] = Field(default_factory=list)
    benefit_category: str = "outpatient"
    verification_codes: list[str] = Field(default_factory=list)
    emergency: bool = False
    tariff: ReferenceTariff | None = None


class PathwayService(Contract):
    code: str
    label: str


class PathwayPriority(Contract):
    codes: list[str]
    kind: Literal["lowest_cost"]
    explanation: str


class EmergencyConfig(Contract):
    label: str
    phone_number: str | None
    source_url: str | None
    checked_at: date | None
    verification_status: VerificationStatus


class PathwaysResource(Contract):
    pathways: list[PathwayConfig]
    emergency: EmergencyConfig
    service_types: list[PathwayService] = Field(default_factory=list)
    help_text: str = "Jelaskan kebutuhan layanan non-darurat; sistem tidak memberi diagnosis."
    priority_rules: list[PathwayPriority] = Field(default_factory=list)


class CountryKB(Contract):
    manifest: CountryManifest
    rules: list[CountryRule]
    coverage_needs: list[CoverageVocabulary]
    pathways: PathwaysResource
    glossary: dict[str, str]
    resources: "CountryResources"

    @model_validator(mode="after")
    def unique_rules(self):
        ids = [rule.rule_id for rule in self.rules]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate KB rule IDs")
        return self


# PRD resource envelopes describe configuration only; no triage/recommendation is activated.
T = TypeVar("T")


class ResourceMetadata(Contract):
    schema_version: Literal["1.5"]
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    source_url: str | None
    checked_at: date | None
    verification_status: VerificationStatus

    @model_validator(mode="after")
    def verified_source(self):
        if self.source_url and not self.source_url.startswith(("https://", "http://")):
            raise ValueError("Source URL must be an explicit HTTP(S) reference")
        if self.verification_status == VerificationStatus.VERIFIED:
            if self.source_url is None or self.checked_at is None:
                raise ValueError("Verified resources require a checked source")
        return self


class VersionedResource(ResourceMetadata, Generic[T]):
    data: T


class VocabularyEntry(Contract):
    code: str = Field(min_length=1)
    label: str = Field(min_length=1)
    aliases: list[str] = Field(default_factory=list)


class TemplateField(Contract):
    field_key: str
    value_type: Literal["text", "date", "money", "number", "boolean", "json"]
    required: bool = False


class ExtractionTemplate(Contract):
    document_type: str
    fields: list[TemplateField]


class SuggestedDocument(Contract):
    document_type: str
    label: str
    requirement_level: Literal["REQUIRED", "RECOMMENDED"]
    source_url: str | None = None

    @model_validator(mode="after")
    def required_needs_source(self):
        if self.requirement_level == "REQUIRED" and self.source_url is None:
            raise ValueError("Required documents need an official checked source before activation")
        return self


class TaskConfig(Contract):
    task_code: str
    label: str
    policy_types: list[str]


class RequiredFieldConfig(Contract):
    task_code: str
    field_key: str
    label: str
    suggested_doc: str | None = None
    applicable: bool = True


class RecommendationRuleConfig(Contract):
    rule_id: str
    priority: int = Field(ge=0)
    conditions: dict[str, JsonValue]
    text_template: str
    task_code: str | None = None
    explanation_template: str = "Periksa data dan sumber sebelum mengambil keputusan."
    action_url: str = "/documents"
    visa_related: bool = False
    regulatory: bool = False
    source_url: str | None = None
    checked_at: date | None = None
    verification_status: VerificationStatus = VerificationStatus.UNVERIFIED
    applicability: Applicability = Field(default_factory=Applicability)


class VerificationStepConfig(Contract):
    code: str
    label: str
    steps: list[str]
    field_key: str | None = None
    known_values: list[str] = Field(default_factory=list)
    impact: str | None = None


class RedFlagConfig(Contract):
    id: str
    category: str
    phrases_id: list[str]
    phrases_en: list[str]
    destination_code: str


class InjectionPattern(Contract):
    pattern_id: str
    pattern: str
    language: Literal["id", "en"]


class CountryResources(Contract):
    rules: VersionedResource[list[CountryRule]]
    coverage_needs: VersionedResource[list[CoverageVocabulary]]
    pathways: VersionedResource[PathwaysResource]
    glossary: VersionedResource[dict[str, str]]
    coverage_types: VersionedResource[list[VocabularyEntry]]
    document_types: VersionedResource[list[VocabularyEntry]]
    extraction_templates: VersionedResource[list[ExtractionTemplate]]
    suggested_docs: VersionedResource[list[SuggestedDocument]]
    tasks: VersionedResource[list[TaskConfig]]
    required_fields: VersionedResource[list[RequiredFieldConfig]]
    recommendation_rules: VersionedResource[list[RecommendationRuleConfig]]
    verification_steps: VersionedResource[list[VerificationStepConfig]]
    red_flags: VersionedResource[list[RedFlagConfig]]
    emergency: VersionedResource[EmergencyConfig]
    example_questions: VersionedResource[list[str]]
    retrieval_terms: VersionedResource[dict[str, list[str]]]

    @model_validator(mode="after")
    def consistent_references(self):
        document_codes = [v.code for v in self.document_types.data]
        coverage_codes = [v.code for v in self.coverage_types.data]
        task_codes = [v.task_code for v in self.tasks.data]
        for codes in (document_codes, coverage_codes, task_codes):
            if len(codes) != len(set(codes)):
                raise ValueError("Duplicate KB vocabulary/task IDs")
        for template in self.extraction_templates.data:
            if template.document_type not in document_codes:
                raise ValueError("Template references unknown document type")
        for item in self.required_fields.data:
            if item.task_code not in task_codes:
                raise ValueError("Required field references unknown task")
            if item.suggested_doc and item.suggested_doc not in document_codes:
                raise ValueError("Required field references unknown document type")
        for suggestion in self.suggested_docs.data:
            if suggestion.document_type not in document_codes:
                raise ValueError("Suggested document references unknown type")
        if self.emergency.data != self.pathways.data.emergency:
            raise ValueError("Emergency resource differs from pathway compatibility metadata")
        return self


CountryKB.model_rebuild()
