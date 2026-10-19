"""Pydantic v2 schemas for the INSURRA Insurance Intelligence Data Pipeline.
Covers China (CN) and Indonesia (ID) knowledge representation.
Never use em dashes in strings or docstrings.
"""

from datetime import date
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PipelineVerificationStatus(StrEnum):
    DISCOVERED = "DISCOVERED"
    COLLECTED = "COLLECTED"
    PARSED = "PARSED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    VERIFIED = "VERIFIED"
    OUTDATED = "OUTDATED"
    REJECTED = "REJECTED"


class AccessDecision(StrEnum):
    API_ALLOWED = "api_allowed"
    DOWNLOAD_ALLOWED = "download_allowed"
    CRAWL_ALLOWED = "crawl_allowed"
    METADATA_ONLY = "metadata_only"
    MANUAL_REVIEW_REQUIRED = "manual_review_required"
    BLOCKED = "blocked"


class SourceCategory(StrEnum):
    REGULATOR = "regulator"
    GOVERNMENT_NATIONAL = "government_national"
    GOVERNMENT_LOCAL = "government_local"
    PUBLIC_HEALTH_SCHEME = "public_health_scheme"
    UNIVERSITY = "university"
    INSURER_OFFICIAL = "insurer_official"
    HEALTHCARE_PROVIDER = "healthcare_provider"
    CLAIMS_ADMINISTRATOR = "claims_administrator"
    LEGISLATION_PORTAL = "legislation_portal"
    CONSUMER_PROTECTION = "consumer_protection"


class SourceRegistryEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    official_identity: str
    url: str
    publisher: str
    jurisdiction: str
    country: Literal["CN", "ID"]
    language: str
    source_category: SourceCategory
    publication_date: date | None = None
    effective_date: date | None = None
    available_formats: list[str] = Field(default_factory=list)
    api_available: bool = False
    bulk_download_available: bool = False
    access_restrictions: str
    terms_of_use_summary: str
    copyright_and_reuse: str
    required_attribution: str | None = None
    retrieval_method: str
    last_checked_date: date
    access_decision: AccessDecision
    blocking_reason: str | None = None
    verification_status: PipelineVerificationStatus = PipelineVerificationStatus.DISCOVERED


class InsurerEntityType(StrEnum):
    INSURANCE_GROUP = "insurance_group"
    UNDERWRITING_COMPANY = "underwriting_company"
    SUBSIDIARY = "subsidiary"
    INSURANCE_AGENCY = "insurance_agency"
    BROKER = "broker"
    TPA = "third_party_administrator"
    STUDENT_INSURANCE_PLATFORM = "student_insurance_platform"


class InsuranceCompany(BaseModel):
    model_config = ConfigDict(extra="forbid")

    insurer_id: str
    legal_entity_name: str
    brand_name: str
    original_local_name: str
    country: Literal["CN", "ID"]
    entity_type: InsurerEntityType
    parent_company: str | None = None
    regulatory_authority: str
    license_reference: str | None = None
    licensing_verification_status: PipelineVerificationStatus
    official_website: str
    business_category: str
    public_customer_service_contact: str | None = None
    official_claim_contact: str | None = None
    official_claim_portal: str | None = None
    brand_asset_ids: list[str] = Field(default_factory=list)
    source_references: list[str] = Field(default_factory=list)
    verification_status: PipelineVerificationStatus = PipelineVerificationStatus.COLLECTED


class AssetType(StrEnum):
    LOGO_PRIMARY = "logo_primary"
    LOGO_HORIZONTAL = "logo_horizontal"
    LOGO_ICON = "logo_icon"
    FAVICON = "favicon"
    SUBSIDIARY_LOGO = "subsidiary_logo"


class LicenseStatus(StrEnum):
    PERMITTED_PUBLIC_MEDIA = "permitted_public_media"
    METADATA_ONLY_NO_REDISTRIBUTION = "metadata_only_no_redistribution"
    RESTRICTED_COPYRIGHT = "restricted_copyright"
    PENDING_PERMISSION = "pending_permission"


class BrandAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str
    insurer_id: str
    product_id: str | None = None
    asset_type: AssetType
    source_url: str
    official_source_domain: str
    original_filename: str
    mime_type: str
    width: int | None = None
    height: int | None = None
    aspect_ratio: str | None = None
    file_size_bytes: int
    sha256: str
    license_status: LicenseStatus
    reuse_permission: str
    attribution_required: bool
    attribution_text: str | None = None
    local_storage_path: str
    collection_date: date
    verification_status: PipelineVerificationStatus


class ProductCategory(StrEnum):
    PUBLIC_SOCIAL_HEALTH = "public_social_health"
    PRIVATE_MEDICAL = "private_medical"
    INTERNATIONAL_STUDENT = "international_student"
    EMPLOYER_GROUP = "employer_group"
    LIFE = "life"
    CRITICAL_ILLNESS = "critical_illness"
    PERSONAL_ACCIDENT = "personal_accident"
    DISABILITY = "disability"
    TRAVEL = "travel"


class InsuranceBenefit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    benefit_id: str
    benefit_category: str
    benefit_name: str
    original_name: str
    covered_event: str
    covered_service: str
    inpatient_applicable: bool
    outpatient_applicable: bool
    benefit_limit: str | None = None
    sublimits: dict[str, str] = Field(default_factory=dict)
    currency: str
    period: str
    eligibility_conditions: list[str] = Field(default_factory=list)
    network_requirements: str | None = None
    reimbursement_rate: str | None = None
    preauthorization_required: bool = False
    evidence_references: list[str] = Field(default_factory=list)


class InsuranceExclusion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exclusion_id: str
    excluded_event_or_service: str
    original_text: str
    conditions_and_exceptions: str | None = None
    waiting_period_days: int | None = None
    deductible: str | None = None
    copayment_percentage: str | None = None
    coinsurance: str | None = None
    excess: str | None = None
    territorial_exclusions: list[str] = Field(default_factory=list)
    pre_existing_condition_provisions: str | None = None
    supporting_policy_clause: str | None = None
    source_page: int | None = None


class InsuranceProduct(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str
    insurer_id: str
    original_product_name: str
    english_name: str
    product_category: ProductCategory
    target_users: list[str]
    eligibility_conditions: list[str]
    coverage_country: Literal["CN", "ID"]
    coverage_territory: str
    product_status: Literal["ACTIVE", "DISCONTINUED", "SUSPENDED"]
    currency: str
    published_pricing: str | None = None
    published_pricing_conditions: str | None = None
    product_url: str | None = None
    policy_document_references: list[str] = Field(default_factory=list)
    effective_from: date | None = None
    effective_to: date | None = None
    product_version: str
    benefits: list[InsuranceBenefit] = Field(default_factory=list)
    exclusions: list[InsuranceExclusion] = Field(default_factory=list)
    verification_status: PipelineVerificationStatus


class CountryRegulation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    regulation_id: str
    country_code: Literal["CN", "ID"]
    jurisdiction: str
    issuing_authority: str
    title_original: str
    title_english: str
    legal_reference_number: str
    promulgation_date: date | None = None
    effective_date: date | None = None
    category: str
    summary: str
    key_provisions: list[str]
    applicable_population: list[str]
    source_url: str
    verification_status: PipelineVerificationStatus


class PublicInsuranceScheme(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scheme_id: str
    country_code: Literal["CN", "ID"]
    jurisdiction: str
    scheme_name_original: str
    scheme_name_english: str
    administrator: str
    membership_categories: list[dict[str, str]]
    contribution_rules: str
    benefit_summary: list[str]
    referral_requirements: str
    administrative_procedures: list[str]
    source_url: str
    verification_status: PipelineVerificationStatus


class UniversityInsuranceRequirement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirement_id: str
    institution_id: str
    institution_name: str
    institution_name_original: str
    city: str
    province: str
    country_code: Literal["CN"] = "CN"
    official_requirement_summary: str
    eligible_student_categories: list[str]
    mandatory_purchase_required: bool
    approved_scheme_name: str
    approved_insurer: str
    required_document_types: list[str]
    coverage_period_requirements: str
    minimum_benefit_limits: dict[str, str] = Field(default_factory=dict)
    relevant_deadlines: str | None = None
    policy_sources: list[str]
    administrative_guidance: str
    verification_status: PipelineVerificationStatus


class ClaimProcedure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    procedure_id: str
    country_code: Literal["CN", "ID"]
    claims_administrator: str
    relevant_product_ids: list[str]
    claim_types: list[str]
    submission_instructions: str
    filing_deadlines: str
    required_forms: list[str]
    submission_channels: list[str]
    official_portal_url: str | None = None
    preauthorization_requirements: str | None = None
    reimbursement_procedures: str
    published_processing_timeline: str
    status_inquiry_channels: list[str] = Field(default_factory=list)
    customer_support_contact: str
    dispute_escalation_guidance: str
    source_url: str
    verification_status: PipelineVerificationStatus


class ClaimEvidenceRequirement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_id: str
    country_code: Literal["CN", "ID"]
    insurer_id: str | None = None
    product_id: str | None = None
    claim_type: str
    evidence_item_name: str
    evidence_item_name_original: str
    description: str
    mandatory: bool
    accepted_formats: list[str]
    special_conditions: str | None = None
    source_url: str
    verification_status: PipelineVerificationStatus


class HealthcareProvider(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_id: str
    country_code: Literal["CN", "ID"]
    name_original: str
    name_english: str
    city: str
    facility_category: str
    facility_tier: str | None = None
    address: str
    official_contact: str
    emergency_service_available: bool
    verified_insurer_affiliations: list[str] = Field(default_factory=list)
    cashless_direct_billing_verified: bool = False
    source_url: str
    verification_status: PipelineVerificationStatus


class MedicalCostReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cost_id: str
    country_code: Literal["CN", "ID"]
    jurisdiction: str
    service_type: str
    service_code: str | None = None
    fee_reference_official: str
    public_pricing: str
    private_pricing_range: str | None = None
    insurer_reimbursement_basis: str
    currency: str
    effective_date: date | None = None
    limitations: str
    source_url: str
    verification_status: PipelineVerificationStatus


class ConsumerDisputeProcedure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dispute_id: str
    country_code: Literal["CN", "ID"]
    authority_name: str
    channel_name: str
    contact_phone: str
    online_portal: str | None = None
    jurisdiction_scope: str
    procedure_summary: str
    published_deadlines: str
    filing_guidance: list[str]
    source_url: str
    verification_status: PipelineVerificationStatus


class MultilingualGlossaryEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    term_id: str
    category: str
    simplified_chinese: str
    indonesian: str
    english_display: str
    definition_en: str
    definition_id: str
    definition_zh: str
    country_specific_notes: dict[str, str] = Field(default_factory=dict)
    related_terms: list[str] = Field(default_factory=list)
    authoritative_source: str


class DeterministicRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_id: str
    country_code: Literal["CN", "ID"]
    jurisdiction: str
    authority: str
    rule_type: str
    applicable_personas: list[str]
    applicability_conditions: dict[str, str]
    required_evidence: list[str]
    comparison_operator: str
    threshold_or_condition: str
    effective_from: date | None = None
    effective_to: date | None = None
    exceptions: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    verification_status: PipelineVerificationStatus


class RAGClauseChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunk_id: str
    country: Literal["CN", "ID"]
    jurisdiction: str
    insurer_id: str
    product_id: str
    product_version: str
    original_language: str
    original_source_text: str
    english_translation: str | None = None
    document_id: str
    page_number: int | None = None
    clause_identifier: str | None = None
    topic: str
    effective_date: date | None = None
    source_url: str
    verification_status: PipelineVerificationStatus
