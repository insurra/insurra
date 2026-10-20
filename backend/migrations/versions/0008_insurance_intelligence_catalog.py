"""Add insurance intelligence catalog tables.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-19
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "source_registry",
        sa.Column("source_id", sa.String(length=100), primary_key=True),
        sa.Column("official_identity", sa.String(length=255), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=False),
        sa.Column("publisher", sa.String(length=255), nullable=False),
        sa.Column("jurisdiction", sa.String(length=100), nullable=False),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("language", sa.String(length=10), nullable=False),
        sa.Column("source_category", sa.String(length=50), nullable=False),
        sa.Column("publication_date", sa.String(length=10), nullable=True),
        sa.Column("effective_date", sa.String(length=10), nullable=True),
        sa.Column("available_formats", sa.JSON(), nullable=False),
        sa.Column("api_available", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("bulk_download_available", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("access_restrictions", sa.Text(), nullable=False),
        sa.Column("terms_of_use_summary", sa.Text(), nullable=False),
        sa.Column("copyright_and_reuse", sa.Text(), nullable=False),
        sa.Column("required_attribution", sa.Text(), nullable=True),
        sa.Column("retrieval_method", sa.String(length=255), nullable=False),
        sa.Column("last_checked_date", sa.String(length=10), nullable=False),
        sa.Column("access_decision", sa.String(length=50), nullable=False),
        sa.Column("blocking_reason", sa.Text(), nullable=True),
        sa.Column("verification_status", sa.String(length=30), nullable=False, server_default=sa.text("'DISCOVERED'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_source_registry_country", "source_registry", ["country"], unique=False)
    op.create_index("ix_source_registry_category", "source_registry", ["source_category"], unique=False)

    op.create_table(
        "data_collection_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("run_code", sa.String(length=100), nullable=False),
        sa.Column("country_scope", sa.String(length=10), nullable=False),
        sa.Column("collector_name", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default=sa.text("'RUNNING'")),
        sa.Column("records_collected", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("records_verified", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("errors_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("run_log", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_data_collection_runs_code", "data_collection_runs", ["run_code"], unique=True)

    op.create_table(
        "insurance_entities",
        sa.Column("entity_id", sa.String(length=100), primary_key=True),
        sa.Column("legal_entity_name", sa.String(length=255), nullable=False),
        sa.Column("brand_name", sa.String(length=100), nullable=False),
        sa.Column("original_local_name", sa.String(length=255), nullable=False),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=False),
        sa.Column("parent_company", sa.String(length=255), nullable=True),
        sa.Column("regulatory_authority", sa.String(length=255), nullable=False),
        sa.Column("license_reference", sa.String(length=100), nullable=True),
        sa.Column("licensing_verification_status", sa.String(length=30), nullable=False),
        sa.Column("official_website", sa.String(length=255), nullable=False),
        sa.Column("business_category", sa.Text(), nullable=False),
        sa.Column("public_customer_service_contact", sa.String(length=100), nullable=True),
        sa.Column("official_claim_contact", sa.String(length=100), nullable=True),
        sa.Column("official_claim_portal", sa.String(length=255), nullable=True),
        sa.Column("verification_status", sa.String(length=30), nullable=False, server_default=sa.text("'COLLECTED'")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_insurance_entities_country", "insurance_entities", ["country"], unique=False)
    op.create_index("ix_insurance_entities_brand_name", "insurance_entities", ["brand_name"], unique=False)

    op.create_table(
        "insurance_brands",
        sa.Column("brand_id", sa.String(length=100), primary_key=True),
        sa.Column("insurer_id", sa.String(length=100), sa.ForeignKey("insurance_entities.entity_id", ondelete="CASCADE"), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("primary_color_hex", sa.String(length=10), nullable=True),
        sa.Column("website_url", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_insurance_brands_insurer_id", "insurance_brands", ["insurer_id"], unique=False)
    op.create_index("ix_insurance_brands_country", "insurance_brands", ["country"], unique=False)

    op.create_table(
        "insurance_brand_assets",
        sa.Column("asset_id", sa.String(length=100), primary_key=True),
        sa.Column("insurer_id", sa.String(length=100), sa.ForeignKey("insurance_entities.entity_id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_type", sa.String(length=50), nullable=False),
        sa.Column("source_url", sa.String(length=500), nullable=False),
        sa.Column("official_source_domain", sa.String(length=100), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=50), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("license_status", sa.String(length=50), nullable=False),
        sa.Column("reuse_permission", sa.String(length=100), nullable=False),
        sa.Column("attribution_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("attribution_text", sa.String(length=255), nullable=True),
        sa.Column("local_storage_path", sa.String(length=500), nullable=False),
        sa.Column("collection_date", sa.String(length=10), nullable=False),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
    )
    op.create_index("ix_insurance_brand_assets_insurer_id", "insurance_brand_assets", ["insurer_id"], unique=False)
    op.create_index("ix_insurance_brand_assets_sha256", "insurance_brand_assets", ["sha256"], unique=False)

    op.create_table(
        "insurance_products",
        sa.Column("product_id", sa.String(length=100), primary_key=True),
        sa.Column("insurer_id", sa.String(length=100), sa.ForeignKey("insurance_entities.entity_id", ondelete="CASCADE"), nullable=False),
        sa.Column("original_product_name", sa.String(length=255), nullable=False),
        sa.Column("english_name", sa.String(length=255), nullable=False),
        sa.Column("product_category", sa.String(length=50), nullable=False),
        sa.Column("target_users", sa.JSON(), nullable=False),
        sa.Column("eligibility_conditions", sa.JSON(), nullable=False),
        sa.Column("coverage_country", sa.String(length=2), nullable=False),
        sa.Column("coverage_territory", sa.String(length=100), nullable=False),
        sa.Column("product_status", sa.String(length=30), nullable=False, server_default=sa.text("'ACTIVE'")),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("published_pricing", sa.String(length=100), nullable=True),
        sa.Column("published_pricing_conditions", sa.String(length=255), nullable=True),
        sa.Column("product_url", sa.String(length=500), nullable=True),
        sa.Column("verification_status", sa.String(length=30), nullable=False, server_default=sa.text("'COLLECTED'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_insurance_products_insurer_id", "insurance_products", ["insurer_id"], unique=False)
    op.create_index("ix_insurance_products_category", "insurance_products", ["product_category"], unique=False)
    op.create_index("ix_insurance_products_country", "insurance_products", ["coverage_country"], unique=False)

    op.create_table(
        "insurance_product_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("product_id", sa.String(length=100), sa.ForeignKey("insurance_products.product_id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_code", sa.String(length=50), nullable=False),
        sa.Column("effective_from", sa.String(length=10), nullable=True),
        sa.Column("effective_to", sa.String(length=10), nullable=True),
        sa.Column("version_summary", sa.Text(), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_index("ix_insurance_product_versions_product_id", "insurance_product_versions", ["product_id"], unique=False)

    op.create_table(
        "insurance_policy_documents",
        sa.Column("document_id", sa.String(length=100), primary_key=True),
        sa.Column("product_id", sa.String(length=100), sa.ForeignKey("insurance_products.product_id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_type", sa.String(length=50), nullable=False),
        sa.Column("title_original", sa.String(length=255), nullable=False),
        sa.Column("title_english", sa.String(length=255), nullable=False),
        sa.Column("file_format", sa.String(length=10), nullable=False),
        sa.Column("source_url", sa.String(length=500), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("storage_path", sa.String(length=500), nullable=True),
        sa.Column("language", sa.String(length=10), nullable=False),
        sa.Column("verification_status", sa.String(length=30), nullable=False, server_default=sa.text("'PARSED'")),
    )
    op.create_index("ix_insurance_policy_documents_product_id", "insurance_policy_documents", ["product_id"], unique=False)

    op.create_table(
        "insurance_benefits",
        sa.Column("benefit_id", sa.String(length=100), primary_key=True),
        sa.Column("product_id", sa.String(length=100), sa.ForeignKey("insurance_products.product_id", ondelete="CASCADE"), nullable=False),
        sa.Column("benefit_category", sa.String(length=100), nullable=False),
        sa.Column("benefit_name", sa.String(length=255), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("covered_event", sa.Text(), nullable=False),
        sa.Column("covered_service", sa.Text(), nullable=False),
        sa.Column("inpatient_applicable", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("outpatient_applicable", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("benefit_limit", sa.String(length=100), nullable=True),
        sa.Column("sublimits", sa.JSON(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("period", sa.String(length=50), nullable=False),
        sa.Column("network_requirements", sa.Text(), nullable=True),
        sa.Column("reimbursement_rate", sa.String(length=255), nullable=True),
        sa.Column("preauthorization_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_insurance_benefits_product_id", "insurance_benefits", ["product_id"], unique=False)

    op.create_table(
        "insurance_exclusions",
        sa.Column("exclusion_id", sa.String(length=100), primary_key=True),
        sa.Column("product_id", sa.String(length=100), sa.ForeignKey("insurance_products.product_id", ondelete="CASCADE"), nullable=False),
        sa.Column("excluded_event_or_service", sa.Text(), nullable=False),
        sa.Column("original_text", sa.Text(), nullable=False),
        sa.Column("conditions_and_exceptions", sa.Text(), nullable=True),
        sa.Column("waiting_period_days", sa.Integer(), nullable=True),
        sa.Column("deductible", sa.String(length=100), nullable=True),
        sa.Column("copayment_percentage", sa.String(length=50), nullable=True),
        sa.Column("coinsurance", sa.String(length=50), nullable=True),
        sa.Column("excess", sa.String(length=100), nullable=True),
        sa.Column("pre_existing_condition_provisions", sa.Text(), nullable=True),
        sa.Column("supporting_policy_clause", sa.String(length=100), nullable=True),
        sa.Column("source_page", sa.Integer(), nullable=True),
    )
    op.create_index("ix_insurance_exclusions_product_id", "insurance_exclusions", ["product_id"], unique=False)

    op.create_table(
        "insurance_claim_procedures",
        sa.Column("procedure_id", sa.String(length=100), primary_key=True),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("claims_administrator", sa.String(length=255), nullable=False),
        sa.Column("claim_types", sa.JSON(), nullable=False),
        sa.Column("submission_instructions", sa.Text(), nullable=False),
        sa.Column("filing_deadlines", sa.String(length=255), nullable=False),
        sa.Column("required_forms", sa.JSON(), nullable=False),
        sa.Column("submission_channels", sa.JSON(), nullable=False),
        sa.Column("official_portal_url", sa.String(length=500), nullable=True),
        sa.Column("reimbursement_procedures", sa.Text(), nullable=False),
        sa.Column("published_processing_timeline", sa.String(length=100), nullable=False),
        sa.Column("customer_support_contact", sa.String(length=100), nullable=False),
        sa.Column("source_url", sa.String(length=500), nullable=False),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
    )
    op.create_index("ix_claim_procedures_country", "insurance_claim_procedures", ["country_code"], unique=False)

    op.create_table(
        "insurance_evidence_requirements",
        sa.Column("evidence_id", sa.String(length=100), primary_key=True),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("insurer_id", sa.String(length=100), nullable=True),
        sa.Column("claim_type", sa.String(length=50), nullable=False),
        sa.Column("evidence_item_name", sa.String(length=255), nullable=False),
        sa.Column("evidence_item_name_original", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("mandatory", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("accepted_formats", sa.JSON(), nullable=False),
        sa.Column("source_url", sa.String(length=500), nullable=False),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
    )
    op.create_index("ix_evidence_req_country", "insurance_evidence_requirements", ["country_code"], unique=False)
    op.create_index("ix_evidence_req_insurer", "insurance_evidence_requirements", ["insurer_id"], unique=False)

    op.create_table(
        "insurance_eligibility_rules",
        sa.Column("rule_id", sa.String(length=100), primary_key=True),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("jurisdiction", sa.String(length=100), nullable=False),
        sa.Column("authority", sa.String(length=255), nullable=False),
        sa.Column("rule_type", sa.String(length=50), nullable=False),
        sa.Column("applicable_personas", sa.JSON(), nullable=False),
        sa.Column("applicability_conditions", sa.JSON(), nullable=False),
        sa.Column("required_evidence", sa.JSON(), nullable=False),
        sa.Column("comparison_operator", sa.String(length=50), nullable=False),
        sa.Column("threshold_or_condition", sa.String(length=255), nullable=False),
        sa.Column("source_ids", sa.JSON(), nullable=False),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
    )
    op.create_index("ix_eligibility_rules_country", "insurance_eligibility_rules", ["country_code"], unique=False)

    op.create_table(
        "insurance_regulations",
        sa.Column("regulation_id", sa.String(length=100), primary_key=True),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("jurisdiction", sa.String(length=100), nullable=False),
        sa.Column("issuing_authority", sa.String(length=100), nullable=False),
        sa.Column("title_original", sa.String(length=255), nullable=False),
        sa.Column("title_english", sa.String(length=255), nullable=False),
        sa.Column("legal_reference_number", sa.String(length=100), nullable=False),
        sa.Column("category", sa.String(length=50), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("key_provisions", sa.JSON(), nullable=False),
        sa.Column("applicable_population", sa.JSON(), nullable=False),
        sa.Column("source_url", sa.String(length=500), nullable=False),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
    )
    op.create_index("ix_regulations_country", "insurance_regulations", ["country_code"], unique=False)

    op.create_table(
        "insurance_public_schemes",
        sa.Column("scheme_id", sa.String(length=100), primary_key=True),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("jurisdiction", sa.String(length=100), nullable=False),
        sa.Column("scheme_name_original", sa.String(length=255), nullable=False),
        sa.Column("scheme_name_english", sa.String(length=255), nullable=False),
        sa.Column("administrator", sa.String(length=100), nullable=False),
        sa.Column("membership_categories", sa.JSON(), nullable=False),
        sa.Column("contribution_rules", sa.Text(), nullable=False),
        sa.Column("benefit_summary", sa.JSON(), nullable=False),
        sa.Column("referral_requirements", sa.Text(), nullable=False),
        sa.Column("source_url", sa.String(length=500), nullable=False),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
    )
    op.create_index("ix_public_schemes_country", "insurance_public_schemes", ["country_code"], unique=False)

    op.create_table(
        "university_insurance_requirements",
        sa.Column("requirement_id", sa.String(length=100), primary_key=True),
        sa.Column("institution_id", sa.String(length=100), nullable=False),
        sa.Column("institution_name", sa.String(length=255), nullable=False),
        sa.Column("institution_name_original", sa.String(length=255), nullable=False),
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column("province", sa.String(length=100), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=False, server_default=sa.text("'CN'")),
        sa.Column("official_requirement_summary", sa.Text(), nullable=False),
        sa.Column("eligible_student_categories", sa.JSON(), nullable=False),
        sa.Column("mandatory_purchase_required", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("approved_scheme_name", sa.String(length=255), nullable=False),
        sa.Column("approved_insurer", sa.String(length=255), nullable=False),
        sa.Column("policy_sources", sa.JSON(), nullable=False),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
    )
    op.create_index("ix_univ_req_inst", "university_insurance_requirements", ["institution_id"], unique=False)

    op.create_table(
        "healthcare_providers",
        sa.Column("provider_id", sa.String(length=100), primary_key=True),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("name_original", sa.String(length=255), nullable=False),
        sa.Column("name_english", sa.String(length=255), nullable=False),
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column("facility_category", sa.String(length=255), nullable=False),
        sa.Column("facility_tier", sa.String(length=100), nullable=True),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("official_contact", sa.String(length=255), nullable=False),
        sa.Column("emergency_service_available", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("source_url", sa.String(length=500), nullable=False),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
    )
    op.create_index("ix_healthcare_providers_country", "healthcare_providers", ["country_code"], unique=False)

    op.create_table(
        "healthcare_network_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("provider_id", sa.String(length=100), sa.ForeignKey("healthcare_providers.provider_id", ondelete="CASCADE"), nullable=False),
        sa.Column("insurer_id", sa.String(length=100), sa.ForeignKey("insurance_entities.entity_id", ondelete="CASCADE"), nullable=False),
        sa.Column("network_tier", sa.String(length=50), nullable=True),
        sa.Column("cashless_direct_billing", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("verification_source_url", sa.String(length=500), nullable=True),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
    )
    op.create_index("ix_network_links_provider", "healthcare_network_links", ["provider_id"], unique=False)
    op.create_index("ix_network_links_insurer", "healthcare_network_links", ["insurer_id"], unique=False)

    op.create_table(
        "healthcare_cost_references",
        sa.Column("cost_id", sa.String(length=100), primary_key=True),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("jurisdiction", sa.String(length=100), nullable=False),
        sa.Column("service_type", sa.String(length=255), nullable=False),
        sa.Column("service_code", sa.String(length=100), nullable=True),
        sa.Column("fee_reference_official", sa.Text(), nullable=False),
        sa.Column("public_pricing", sa.String(length=255), nullable=False),
        sa.Column("insurer_reimbursement_basis", sa.Text(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("source_url", sa.String(length=500), nullable=False),
        sa.Column("verification_status", sa.String(length=30), nullable=False),
    )
    op.create_index("ix_cost_references_country", "healthcare_cost_references", ["country_code"], unique=False)

    op.create_table(
        "insurance_glossary",
        sa.Column("term_id", sa.String(length=100), primary_key=True),
        sa.Column("category", sa.String(length=50), nullable=False),
        sa.Column("simplified_chinese", sa.String(length=100), nullable=False),
        sa.Column("indonesian", sa.String(length=100), nullable=False),
        sa.Column("english_display", sa.String(length=100), nullable=False),
        sa.Column("definition_en", sa.Text(), nullable=False),
        sa.Column("definition_id", sa.Text(), nullable=False),
        sa.Column("definition_zh", sa.Text(), nullable=False),
        sa.Column("authoritative_source", sa.String(length=500), nullable=False),
    )

    op.create_table(
        "data_quality_issues",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("run_id", sa.Uuid(), sa.ForeignKey("data_collection_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("dataset_name", sa.String(length=100), nullable=False),
        sa.Column("record_id", sa.String(length=100), nullable=False),
        sa.Column("issue_type", sa.String(length=50), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("remediation_required", sa.Text(), nullable=False),
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_data_quality_issues_run_id", "data_quality_issues", ["run_id"], unique=False)


def downgrade():
    op.drop_table("data_quality_issues")
    op.drop_table("insurance_glossary")
    op.drop_table("healthcare_cost_references")
    op.drop_table("healthcare_network_links")
    op.drop_table("healthcare_providers")
    op.drop_table("university_insurance_requirements")
    op.drop_table("insurance_public_schemes")
    op.drop_table("insurance_regulations")
    op.drop_table("insurance_eligibility_rules")
    op.drop_table("insurance_evidence_requirements")
    op.drop_table("insurance_claim_procedures")
    op.drop_table("insurance_exclusions")
    op.drop_table("insurance_benefits")
    op.drop_table("insurance_policy_documents")
    op.drop_table("insurance_product_versions")
    op.drop_table("insurance_products")
    op.drop_table("insurance_brand_assets")
    op.drop_table("insurance_brands")
    op.drop_table("insurance_entities")
    op.drop_table("data_collection_runs")
    op.drop_table("source_registry")
