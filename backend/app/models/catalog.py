"""Normalized database entities for the INSURRA Insurance Intelligence Catalog.
Covers public knowledge, regulatory datasets, products, healthcare, and quality audits.
Never use em dashes in strings or docstrings.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class SourceRegistryRow(Base):
    __tablename__ = "source_registry"

    source_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    official_identity: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(String(500))
    publisher: Mapped[str] = mapped_column(String(255))
    jurisdiction: Mapped[str] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(2), index=True)
    language: Mapped[str] = mapped_column(String(10))
    source_category: Mapped[str] = mapped_column(String(50), index=True)
    publication_date: Mapped[str | None] = mapped_column(String(10))
    effective_date: Mapped[str | None] = mapped_column(String(10))
    available_formats: Mapped[dict] = mapped_column(JSON, default=list)
    api_available: Mapped[bool] = mapped_column(Boolean, default=False)
    bulk_download_available: Mapped[bool] = mapped_column(Boolean, default=False)
    access_restrictions: Mapped[str] = mapped_column(Text)
    terms_of_use_summary: Mapped[str] = mapped_column(Text)
    copyright_and_reuse: Mapped[str] = mapped_column(Text)
    required_attribution: Mapped[str | None] = mapped_column(Text)
    retrieval_method: Mapped[str] = mapped_column(String(255))
    last_checked_date: Mapped[str] = mapped_column(String(10))
    access_decision: Mapped[str] = mapped_column(String(50))
    blocking_reason: Mapped[str | None] = mapped_column(Text)
    verification_status: Mapped[str] = mapped_column(String(30), default="DISCOVERED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DataCollectionRunRow(Base):
    __tablename__ = "data_collection_runs"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    run_code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    country_scope: Mapped[str] = mapped_column(String(10))
    collector_name: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30), default="RUNNING")
    records_collected: Mapped[int] = mapped_column(Integer, default=0)
    records_verified: Mapped[int] = mapped_column(Integer, default=0)
    errors_count: Mapped[int] = mapped_column(Integer, default=0)
    run_log: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InsuranceEntityRow(Base):
    __tablename__ = "insurance_entities"

    entity_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    legal_entity_name: Mapped[str] = mapped_column(String(255))
    brand_name: Mapped[str] = mapped_column(String(100), index=True)
    original_local_name: Mapped[str] = mapped_column(String(255))
    country: Mapped[str] = mapped_column(String(2), index=True)
    entity_type: Mapped[str] = mapped_column(String(50))
    parent_company: Mapped[str | None] = mapped_column(String(255))
    regulatory_authority: Mapped[str] = mapped_column(String(255))
    license_reference: Mapped[str | None] = mapped_column(String(100))
    licensing_verification_status: Mapped[str] = mapped_column(String(30))
    official_website: Mapped[str] = mapped_column(String(255))
    business_category: Mapped[str] = mapped_column(Text)
    public_customer_service_contact: Mapped[str | None] = mapped_column(String(100))
    official_claim_contact: Mapped[str | None] = mapped_column(String(100))
    official_claim_portal: Mapped[str | None] = mapped_column(String(255))
    verification_status: Mapped[str] = mapped_column(String(30), default="COLLECTED")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class InsuranceBrandRow(Base):
    __tablename__ = "insurance_brands"

    brand_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    insurer_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("insurance_entities.entity_id", ondelete="CASCADE"), index=True
    )
    display_name: Mapped[str] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(2), index=True)
    primary_color_hex: Mapped[str | None] = mapped_column(String(10))
    website_url: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class InsuranceBrandAssetRow(Base):
    __tablename__ = "insurance_brand_assets"

    asset_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    insurer_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("insurance_entities.entity_id", ondelete="CASCADE"), index=True
    )
    asset_type: Mapped[str] = mapped_column(String(50))
    source_url: Mapped[str] = mapped_column(String(500))
    official_source_domain: Mapped[str] = mapped_column(String(100))
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(50))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    file_size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    license_status: Mapped[str] = mapped_column(String(50))
    reuse_permission: Mapped[str] = mapped_column(String(100))
    attribution_required: Mapped[bool] = mapped_column(Boolean, default=False)
    attribution_text: Mapped[str | None] = mapped_column(String(255))
    local_storage_path: Mapped[str] = mapped_column(String(500))
    collection_date: Mapped[str] = mapped_column(String(10))
    verification_status: Mapped[str] = mapped_column(String(30))


class InsuranceProductRow(Base):
    __tablename__ = "insurance_products"

    product_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    insurer_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("insurance_entities.entity_id", ondelete="CASCADE"), index=True
    )
    original_product_name: Mapped[str] = mapped_column(String(255))
    english_name: Mapped[str] = mapped_column(String(255))
    product_category: Mapped[str] = mapped_column(String(50), index=True)
    target_users: Mapped[dict] = mapped_column(JSON, default=list)
    eligibility_conditions: Mapped[dict] = mapped_column(JSON, default=list)
    coverage_country: Mapped[str] = mapped_column(String(2), index=True)
    coverage_territory: Mapped[str] = mapped_column(String(100))
    product_status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    currency: Mapped[str] = mapped_column(String(3))
    published_pricing: Mapped[str | None] = mapped_column(String(100))
    published_pricing_conditions: Mapped[str | None] = mapped_column(String(255))
    product_url: Mapped[str | None] = mapped_column(String(500))
    verification_status: Mapped[str] = mapped_column(String(30), default="COLLECTED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class InsuranceProductVersionRow(Base):
    __tablename__ = "insurance_product_versions"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    product_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("insurance_products.product_id", ondelete="CASCADE"), index=True
    )
    version_code: Mapped[str] = mapped_column(String(50))
    effective_from: Mapped[str | None] = mapped_column(String(10))
    effective_to: Mapped[str | None] = mapped_column(String(10))
    version_summary: Mapped[str | None] = mapped_column(Text)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)


class InsurancePolicyDocumentRow(Base):
    __tablename__ = "insurance_policy_documents"

    document_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    product_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("insurance_products.product_id", ondelete="CASCADE"), index=True
    )
    document_type: Mapped[str] = mapped_column(String(50))
    title_original: Mapped[str] = mapped_column(String(255))
    title_english: Mapped[str] = mapped_column(String(255))
    file_format: Mapped[str] = mapped_column(String(10))
    source_url: Mapped[str] = mapped_column(String(500))
    sha256: Mapped[str | None] = mapped_column(String(64))
    storage_path: Mapped[str | None] = mapped_column(String(500))
    language: Mapped[str] = mapped_column(String(10))
    verification_status: Mapped[str] = mapped_column(String(30), default="PARSED")


class InsuranceBenefitRow(Base):
    __tablename__ = "insurance_benefits"

    benefit_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    product_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("insurance_products.product_id", ondelete="CASCADE"), index=True
    )
    benefit_category: Mapped[str] = mapped_column(String(100))
    benefit_name: Mapped[str] = mapped_column(String(255))
    original_name: Mapped[str] = mapped_column(String(255))
    covered_event: Mapped[str] = mapped_column(Text)
    covered_service: Mapped[str] = mapped_column(Text)
    inpatient_applicable: Mapped[bool] = mapped_column(Boolean, default=True)
    outpatient_applicable: Mapped[bool] = mapped_column(Boolean, default=True)
    benefit_limit: Mapped[str | None] = mapped_column(String(100))
    sublimits: Mapped[dict] = mapped_column(JSON, default=dict)
    currency: Mapped[str] = mapped_column(String(3))
    period: Mapped[str] = mapped_column(String(50))
    network_requirements: Mapped[str | None] = mapped_column(Text)
    reimbursement_rate: Mapped[str | None] = mapped_column(String(255))
    preauthorization_required: Mapped[bool] = mapped_column(Boolean, default=False)


class InsuranceExclusionRow(Base):
    __tablename__ = "insurance_exclusions"

    exclusion_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    product_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("insurance_products.product_id", ondelete="CASCADE"), index=True
    )
    excluded_event_or_service: Mapped[str] = mapped_column(Text)
    original_text: Mapped[str] = mapped_column(Text)
    conditions_and_exceptions: Mapped[str | None] = mapped_column(Text)
    waiting_period_days: Mapped[int | None] = mapped_column(Integer)
    deductible: Mapped[str | None] = mapped_column(String(100))
    copayment_percentage: Mapped[str | None] = mapped_column(String(50))
    coinsurance: Mapped[str | None] = mapped_column(String(50))
    excess: Mapped[str | None] = mapped_column(String(100))
    pre_existing_condition_provisions: Mapped[str | None] = mapped_column(Text)
    supporting_policy_clause: Mapped[str | None] = mapped_column(String(100))
    source_page: Mapped[int | None] = mapped_column(Integer)


class InsuranceClaimProcedureRow(Base):
    __tablename__ = "insurance_claim_procedures"

    procedure_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    country_code: Mapped[str] = mapped_column(String(2), index=True)
    claims_administrator: Mapped[str] = mapped_column(String(255))
    claim_types: Mapped[dict] = mapped_column(JSON, default=list)
    submission_instructions: Mapped[str] = mapped_column(Text)
    filing_deadlines: Mapped[str] = mapped_column(String(255))
    required_forms: Mapped[dict] = mapped_column(JSON, default=list)
    submission_channels: Mapped[dict] = mapped_column(JSON, default=list)
    official_portal_url: Mapped[str | None] = mapped_column(String(500))
    reimbursement_procedures: Mapped[str] = mapped_column(Text)
    published_processing_timeline: Mapped[str] = mapped_column(String(100))
    customer_support_contact: Mapped[str] = mapped_column(String(100))
    source_url: Mapped[str] = mapped_column(String(500))
    verification_status: Mapped[str] = mapped_column(String(30))


class InsuranceEvidenceRequirementRow(Base):
    __tablename__ = "insurance_evidence_requirements"

    evidence_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    country_code: Mapped[str] = mapped_column(String(2), index=True)
    insurer_id: Mapped[str | None] = mapped_column(String(100), index=True)
    claim_type: Mapped[str] = mapped_column(String(50))
    evidence_item_name: Mapped[str] = mapped_column(String(255))
    evidence_item_name_original: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    mandatory: Mapped[bool] = mapped_column(Boolean, default=True)
    accepted_formats: Mapped[dict] = mapped_column(JSON, default=list)
    source_url: Mapped[str] = mapped_column(String(500))
    verification_status: Mapped[str] = mapped_column(String(30))


class InsuranceEligibilityRuleRow(Base):
    __tablename__ = "insurance_eligibility_rules"

    rule_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    country_code: Mapped[str] = mapped_column(String(2), index=True)
    jurisdiction: Mapped[str] = mapped_column(String(100))
    authority: Mapped[str] = mapped_column(String(255))
    rule_type: Mapped[str] = mapped_column(String(50))
    applicable_personas: Mapped[dict] = mapped_column(JSON, default=list)
    applicability_conditions: Mapped[dict] = mapped_column(JSON, default=dict)
    required_evidence: Mapped[dict] = mapped_column(JSON, default=list)
    comparison_operator: Mapped[str] = mapped_column(String(50))
    threshold_or_condition: Mapped[str] = mapped_column(String(255))
    source_ids: Mapped[dict] = mapped_column(JSON, default=list)
    verification_status: Mapped[str] = mapped_column(String(30))


class InsuranceRegulationRow(Base):
    __tablename__ = "insurance_regulations"

    regulation_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    country_code: Mapped[str] = mapped_column(String(2), index=True)
    jurisdiction: Mapped[str] = mapped_column(String(100))
    issuing_authority: Mapped[str] = mapped_column(String(100))
    title_original: Mapped[str] = mapped_column(String(255))
    title_english: Mapped[str] = mapped_column(String(255))
    legal_reference_number: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(50))
    summary: Mapped[str] = mapped_column(Text)
    key_provisions: Mapped[dict] = mapped_column(JSON, default=list)
    applicable_population: Mapped[dict] = mapped_column(JSON, default=list)
    source_url: Mapped[str] = mapped_column(String(500))
    verification_status: Mapped[str] = mapped_column(String(30))


class InsurancePublicSchemeRow(Base):
    __tablename__ = "insurance_public_schemes"

    scheme_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    country_code: Mapped[str] = mapped_column(String(2), index=True)
    jurisdiction: Mapped[str] = mapped_column(String(100))
    scheme_name_original: Mapped[str] = mapped_column(String(255))
    scheme_name_english: Mapped[str] = mapped_column(String(255))
    administrator: Mapped[str] = mapped_column(String(100))
    membership_categories: Mapped[dict] = mapped_column(JSON, default=list)
    contribution_rules: Mapped[str] = mapped_column(Text)
    benefit_summary: Mapped[dict] = mapped_column(JSON, default=list)
    referral_requirements: Mapped[str] = mapped_column(Text)
    source_url: Mapped[str] = mapped_column(String(500))
    verification_status: Mapped[str] = mapped_column(String(30))


class UniversityInsuranceRequirementRow(Base):
    __tablename__ = "university_insurance_requirements"

    requirement_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    institution_id: Mapped[str] = mapped_column(String(100), index=True)
    institution_name: Mapped[str] = mapped_column(String(255))
    institution_name_original: Mapped[str] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(100))
    province: Mapped[str] = mapped_column(String(100))
    country_code: Mapped[str] = mapped_column(String(2), default="CN")
    official_requirement_summary: Mapped[str] = mapped_column(Text)
    eligible_student_categories: Mapped[dict] = mapped_column(JSON, default=list)
    mandatory_purchase_required: Mapped[bool] = mapped_column(Boolean, default=True)
    approved_scheme_name: Mapped[str] = mapped_column(String(255))
    approved_insurer: Mapped[str] = mapped_column(String(255))
    policy_sources: Mapped[dict] = mapped_column(JSON, default=list)
    verification_status: Mapped[str] = mapped_column(String(30))


class HealthcareProviderRow(Base):
    __tablename__ = "healthcare_providers"

    provider_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    country_code: Mapped[str] = mapped_column(String(2), index=True)
    name_original: Mapped[str] = mapped_column(String(255))
    name_english: Mapped[str] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(100))
    facility_category: Mapped[str] = mapped_column(String(255))
    facility_tier: Mapped[str | None] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(Text)
    official_contact: Mapped[str] = mapped_column(String(255))
    emergency_service_available: Mapped[bool] = mapped_column(Boolean, default=True)
    source_url: Mapped[str] = mapped_column(String(500))
    verification_status: Mapped[str] = mapped_column(String(30))


class HealthcareNetworkLinkRow(Base):
    __tablename__ = "healthcare_network_links"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    provider_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("healthcare_providers.provider_id", ondelete="CASCADE"), index=True
    )
    insurer_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("insurance_entities.entity_id", ondelete="CASCADE"), index=True
    )
    network_tier: Mapped[str | None] = mapped_column(String(50))
    cashless_direct_billing: Mapped[bool] = mapped_column(Boolean, default=False)
    verification_source_url: Mapped[str | None] = mapped_column(String(500))
    verification_status: Mapped[str] = mapped_column(String(30))


class HealthcareCostReferenceRow(Base):
    __tablename__ = "healthcare_cost_references"

    cost_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    country_code: Mapped[str] = mapped_column(String(2), index=True)
    jurisdiction: Mapped[str] = mapped_column(String(100))
    service_type: Mapped[str] = mapped_column(String(255))
    service_code: Mapped[str | None] = mapped_column(String(100))
    fee_reference_official: Mapped[str] = mapped_column(Text)
    public_pricing: Mapped[str] = mapped_column(String(255))
    insurer_reimbursement_basis: Mapped[str] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(String(3))
    source_url: Mapped[str] = mapped_column(String(500))
    verification_status: Mapped[str] = mapped_column(String(30))


class InsuranceGlossaryRow(Base):
    __tablename__ = "insurance_glossary"

    term_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    category: Mapped[str] = mapped_column(String(50))
    simplified_chinese: Mapped[str] = mapped_column(String(100))
    indonesian: Mapped[str] = mapped_column(String(100))
    english_display: Mapped[str] = mapped_column(String(100))
    definition_en: Mapped[str] = mapped_column(Text)
    definition_id: Mapped[str] = mapped_column(Text)
    definition_zh: Mapped[str] = mapped_column(Text)
    authoritative_source: Mapped[str] = mapped_column(String(500))


class DataQualityIssueRow(Base):
    __tablename__ = "data_quality_issues"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    run_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("data_collection_runs.id", ondelete="SET NULL"), index=True
    )
    dataset_name: Mapped[str] = mapped_column(String(100))
    record_id: Mapped[str] = mapped_column(String(100))
    issue_type: Mapped[str] = mapped_column(String(50))
    severity: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(Text)
    remediation_required: Mapped[str] = mapped_column(Text)
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
