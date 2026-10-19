"""Knowledge Base and Database Exporter.
Exports all normalized datasets to kb/global, kb/CN, kb/ID, and database tables.
Generates team data packages for Regina, Valen, and Joshua.
Never use em dashes in strings or docstrings.
"""

import json
from datetime import UTC, date, datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.catalog import (
    DataCollectionRunRow,
    HealthcareCostReferenceRow,
    HealthcareProviderRow,
    InsuranceBenefitRow,
    InsuranceBrandAssetRow,
    InsuranceBrandRow,
    InsuranceClaimProcedureRow,
    InsuranceEligibilityRuleRow,
    InsuranceEntityRow,
    InsuranceEvidenceRequirementRow,
    InsuranceExclusionRow,
    InsuranceGlossaryRow,
    InsuranceProductRow,
    InsurancePublicSchemeRow,
    InsuranceRegulationRow,
    SourceRegistryRow,
    UniversityInsuranceRequirementRow,
)
from app.pipeline.discovery.registry import OFFICIAL_SOURCES
from app.pipeline.extraction.templates import EXTRACTION_TEMPLATES
from app.pipeline.generators.cn_data import (
    CN_CLAIM_EVIDENCE,
    CN_CLAIM_PROCEDURES,
    CN_COMPANIES,
    CN_CONSUMER_DISPUTES,
    CN_HEALTHCARE_PROVIDERS,
    CN_MEDICAL_COSTS,
    CN_PRODUCTS,
    CN_PUBLIC_SCHEMES,
    CN_REGULATIONS,
    CN_UNIVERSITY_REQUIREMENTS,
)
from app.pipeline.generators.global_data import (
    DATA_QUALITY_RULES_SPEC,
    GLOBAL_DOCUMENT_TAXONOMY,
    GLOBAL_GLOSSARY_ENTRIES,
    GLOBAL_INSURANCE_TAXONOMY,
    INJECTION_PATTERNS_SPEC,
)
from app.pipeline.generators.id_data import (
    ID_CLAIM_EVIDENCE,
    ID_CLAIM_PROCEDURES,
    ID_COMPANIES,
    ID_CONSUMER_DISPUTES,
    ID_HEALTHCARE_PROVIDERS,
    ID_MEDICAL_COSTS,
    ID_PRODUCTS,
    ID_PUBLIC_SCHEMES,
    ID_REGULATIONS,
)
from app.pipeline.generators.rules_data import DETERMINISTIC_RULES
from app.pipeline.rag.chunker import CN_RAG_CHUNKS, ID_RAG_CHUNKS
from app.pipeline.schemas.models import BrandAsset


def serialize_pydantic_list(items: list) -> list[dict]:
    return [item.model_dump(mode="json") for item in items]


class KBExporter:
    def __init__(self, kb_root: Path):
        self.kb_root = kb_root
        self.global_dir = kb_root / "global"
        self.cn_dir = kb_root / "CN"
        self.id_dir = kb_root / "ID"
        self.exports_dir = kb_root / "exports"

    def export_all(self, brand_assets: list[BrandAsset]) -> dict[str, int]:
        """Exports all datasets to disk."""
        self.global_dir.mkdir(parents=True, exist_ok=True)
        self.cn_dir.mkdir(parents=True, exist_ok=True)
        self.id_dir.mkdir(parents=True, exist_ok=True)
        self.exports_dir.mkdir(parents=True, exist_ok=True)
        (self.global_dir / "extraction_schemas").mkdir(parents=True, exist_ok=True)

        counts = {}

        # 1. Global datasets
        (self.global_dir / "insurance_taxonomy.json").write_text(
            json.dumps(GLOBAL_INSURANCE_TAXONOMY, indent=2, ensure_ascii=False)
        )
        (self.global_dir / "document_taxonomy.json").write_text(
            json.dumps(GLOBAL_DOCUMENT_TAXONOMY, indent=2, ensure_ascii=False)
        )
        (self.global_dir / "glossary.json").write_text(
            json.dumps(
                serialize_pydantic_list(GLOBAL_GLOSSARY_ENTRIES), indent=2, ensure_ascii=False
            )
        )
        (self.global_dir / "data_quality_rules.json").write_text(
            json.dumps(DATA_QUALITY_RULES_SPEC, indent=2, ensure_ascii=False)
        )
        (self.global_dir / "injection_patterns.json").write_text(
            json.dumps(INJECTION_PATTERNS_SPEC, indent=2, ensure_ascii=False)
        )
        (self.global_dir / "source_registry.json").write_text(
            json.dumps(serialize_pydantic_list(OFFICIAL_SOURCES), indent=2, ensure_ascii=False)
        )
        counts["global_sources"] = len(OFFICIAL_SOURCES)
        counts["global_glossary"] = len(GLOBAL_GLOSSARY_ENTRIES)

        # Extraction schemas in global
        for tmpl in EXTRACTION_TEMPLATES:
            schema_file = self.global_dir / "extraction_schemas" / f"{tmpl.template_id}.json"
            schema_file.write_text(
                json.dumps(tmpl.model_dump(mode="json"), indent=2, ensure_ascii=False)
            )
        counts["extraction_templates"] = len(EXTRACTION_TEMPLATES)

        # 2. China datasets
        (self.cn_dir / "companies.json").write_text(
            json.dumps(serialize_pydantic_list(CN_COMPANIES), indent=2, ensure_ascii=False)
        )
        (self.cn_dir / "products.json").write_text(
            json.dumps(serialize_pydantic_list(CN_PRODUCTS), indent=2, ensure_ascii=False)
        )
        (self.cn_dir / "regulations.json").write_text(
            json.dumps(serialize_pydantic_list(CN_REGULATIONS), indent=2, ensure_ascii=False)
        )
        (self.cn_dir / "insurance_schemes.json").write_text(
            json.dumps(serialize_pydantic_list(CN_PUBLIC_SCHEMES), indent=2, ensure_ascii=False)
        )
        (self.cn_dir / "university_requirements.json").write_text(
            json.dumps(
                serialize_pydantic_list(CN_UNIVERSITY_REQUIREMENTS), indent=2, ensure_ascii=False
            )
        )
        (self.cn_dir / "claims_procedures.json").write_text(
            json.dumps(serialize_pydantic_list(CN_CLAIM_PROCEDURES), indent=2, ensure_ascii=False)
        )
        (self.cn_dir / "claim_evidence.json").write_text(
            json.dumps(serialize_pydantic_list(CN_CLAIM_EVIDENCE), indent=2, ensure_ascii=False)
        )
        (self.cn_dir / "network_providers.json").write_text(
            json.dumps(
                serialize_pydantic_list(CN_HEALTHCARE_PROVIDERS), indent=2, ensure_ascii=False
            )
        )
        (self.cn_dir / "medical_costs.json").write_text(
            json.dumps(serialize_pydantic_list(CN_MEDICAL_COSTS), indent=2, ensure_ascii=False)
        )
        (self.cn_dir / "consumer_disputes.json").write_text(
            json.dumps(serialize_pydantic_list(CN_CONSUMER_DISPUTES), indent=2, ensure_ascii=False)
        )
        (self.cn_dir / "rag_chunks.json").write_text(
            json.dumps(serialize_pydantic_list(CN_RAG_CHUNKS), indent=2, ensure_ascii=False)
        )
        counts["cn_companies"] = len(CN_COMPANIES)
        counts["cn_products"] = len(CN_PRODUCTS)
        counts["cn_rag_chunks"] = len(CN_RAG_CHUNKS)

        # 3. Indonesia datasets
        (self.id_dir / "companies.json").write_text(
            json.dumps(serialize_pydantic_list(ID_COMPANIES), indent=2, ensure_ascii=False)
        )
        (self.id_dir / "products.json").write_text(
            json.dumps(serialize_pydantic_list(ID_PRODUCTS), indent=2, ensure_ascii=False)
        )
        (self.id_dir / "regulations.json").write_text(
            json.dumps(serialize_pydantic_list(ID_REGULATIONS), indent=2, ensure_ascii=False)
        )
        (self.id_dir / "insurance_schemes.json").write_text(
            json.dumps(serialize_pydantic_list(ID_PUBLIC_SCHEMES), indent=2, ensure_ascii=False)
        )
        (self.id_dir / "claims_procedures.json").write_text(
            json.dumps(serialize_pydantic_list(ID_CLAIM_PROCEDURES), indent=2, ensure_ascii=False)
        )
        (self.id_dir / "claim_evidence.json").write_text(
            json.dumps(serialize_pydantic_list(ID_CLAIM_EVIDENCE), indent=2, ensure_ascii=False)
        )
        (self.id_dir / "network_providers.json").write_text(
            json.dumps(
                serialize_pydantic_list(ID_HEALTHCARE_PROVIDERS), indent=2, ensure_ascii=False
            )
        )
        (self.id_dir / "medical_costs.json").write_text(
            json.dumps(serialize_pydantic_list(ID_MEDICAL_COSTS), indent=2, ensure_ascii=False)
        )
        (self.id_dir / "consumer_disputes.json").write_text(
            json.dumps(serialize_pydantic_list(ID_CONSUMER_DISPUTES), indent=2, ensure_ascii=False)
        )
        (self.id_dir / "rag_chunks.json").write_text(
            json.dumps(serialize_pydantic_list(ID_RAG_CHUNKS), indent=2, ensure_ascii=False)
        )
        counts["id_companies"] = len(ID_COMPANIES)
        counts["id_products"] = len(ID_PRODUCTS)
        counts["id_rag_chunks"] = len(ID_RAG_CHUNKS)

        # 4. Team-specific data packages
        regina_package = {
            "recipient": "Regina (Frontend & Client Architecture)",
            "description": "Company registry, permitted brand logos, product catalog, document taxonomy, extraction schemas",
            "generated_at": date(2026, 10, 18).isoformat(),
            "companies": serialize_pydantic_list(CN_COMPANIES + ID_COMPANIES),
            "products": serialize_pydantic_list(CN_PRODUCTS + ID_PRODUCTS),
            "brand_assets": serialize_pydantic_list(brand_assets),
            "document_taxonomy": GLOBAL_DOCUMENT_TAXONOMY,
            "extraction_templates": [t.model_dump(mode="json") for t in EXTRACTION_TEMPLATES],
        }
        (self.exports_dir / "regina_data_package.json").write_text(
            json.dumps(regina_package, indent=2, ensure_ascii=False)
        )

        valen_package = {
            "recipient": "Valen (RAG, Policy Verification, Coverage Assessment)",
            "description": "Source-linked RAG policy clause chunks, benefits, exclusions, healthcare cost references, care pathways, glossary",
            "generated_at": date(2026, 10, 18).isoformat(),
            "rag_chunks_cn": serialize_pydantic_list(CN_RAG_CHUNKS),
            "rag_chunks_id": serialize_pydantic_list(ID_RAG_CHUNKS),
            "medical_costs_cn": serialize_pydantic_list(CN_MEDICAL_COSTS),
            "medical_costs_id": serialize_pydantic_list(ID_MEDICAL_COSTS),
            "multilingual_glossary": serialize_pydantic_list(GLOBAL_GLOSSARY_ENTRIES),
            "healthcare_providers_cn": serialize_pydantic_list(CN_HEALTHCARE_PROVIDERS),
            "healthcare_providers_id": serialize_pydantic_list(ID_HEALTHCARE_PROVIDERS),
        }
        (self.exports_dir / "valen_data_package.json").write_text(
            json.dumps(valen_package, indent=2, ensure_ascii=False)
        )

        joshua_package = {
            "recipient": "Joshua (Actions, Workflows, Claims, Regulatory Engine)",
            "description": "Regulations, public health schemes, university requirements, claims procedures, claim evidence checklists, dispute procedures",
            "generated_at": date(2026, 10, 18).isoformat(),
            "regulations_cn": serialize_pydantic_list(CN_REGULATIONS),
            "regulations_id": serialize_pydantic_list(ID_REGULATIONS),
            "schemes_cn": serialize_pydantic_list(CN_PUBLIC_SCHEMES),
            "schemes_id": serialize_pydantic_list(ID_PUBLIC_SCHEMES),
            "university_requirements_cn": serialize_pydantic_list(CN_UNIVERSITY_REQUIREMENTS),
            "claims_procedures_cn": serialize_pydantic_list(CN_CLAIM_PROCEDURES),
            "claims_procedures_id": serialize_pydantic_list(ID_CLAIM_PROCEDURES),
            "claim_evidence_cn": serialize_pydantic_list(CN_CLAIM_EVIDENCE),
            "claim_evidence_id": serialize_pydantic_list(ID_CLAIM_EVIDENCE),
            "consumer_disputes_cn": serialize_pydantic_list(CN_CONSUMER_DISPUTES),
            "consumer_disputes_id": serialize_pydantic_list(ID_CONSUMER_DISPUTES),
            "deterministic_rules": serialize_pydantic_list(DETERMINISTIC_RULES),
        }
        (self.exports_dir / "joshua_data_package.json").write_text(
            json.dumps(joshua_package, indent=2, ensure_ascii=False)
        )

        return counts

    def ingest_into_database(self, db: Session, brand_assets: list[BrandAsset]) -> int:
        """Ingests normalized records into the relational catalog tables."""
        total_rows = 0

        # Ingest Sources
        for src in OFFICIAL_SOURCES:
            existing = db.get(SourceRegistryRow, src.source_id)
            if not existing:
                row = SourceRegistryRow(
                    source_id=src.source_id,
                    official_identity=src.official_identity,
                    url=src.url,
                    publisher=src.publisher,
                    jurisdiction=src.jurisdiction,
                    country=src.country,
                    language=src.language,
                    source_category=src.source_category.value,
                    publication_date=src.publication_date.isoformat()
                    if src.publication_date
                    else None,
                    effective_date=src.effective_date.isoformat() if src.effective_date else None,
                    available_formats={"formats": src.available_formats},
                    api_available=src.api_available,
                    bulk_download_available=src.bulk_download_available,
                    access_restrictions=src.access_restrictions,
                    terms_of_use_summary=src.terms_of_use_summary,
                    copyright_and_reuse=src.copyright_and_reuse,
                    required_attribution=src.required_attribution,
                    retrieval_method=src.retrieval_method,
                    last_checked_date=src.last_checked_date.isoformat(),
                    access_decision=src.access_decision.value,
                    blocking_reason=src.blocking_reason,
                    verification_status=src.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        db.flush()

        # Ingest Companies
        all_companies = CN_COMPANIES + ID_COMPANIES
        for c in all_companies:
            existing = db.get(InsuranceEntityRow, c.insurer_id)
            if not existing:
                row = InsuranceEntityRow(
                    entity_id=c.insurer_id,
                    legal_entity_name=c.legal_entity_name,
                    brand_name=c.brand_name,
                    original_local_name=c.original_local_name,
                    country=c.country,
                    entity_type=c.entity_type.value,
                    parent_company=c.parent_company,
                    regulatory_authority=c.regulatory_authority,
                    license_reference=c.license_reference,
                    licensing_verification_status=c.licensing_verification_status.value,
                    official_website=c.official_website,
                    business_category=c.business_category,
                    public_customer_service_contact=c.public_customer_service_contact,
                    official_claim_contact=c.official_claim_contact,
                    official_claim_portal=c.official_claim_portal,
                    verification_status=c.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        db.flush()

        # Ingest Brands
        for c in all_companies:
            b_existing = db.get(InsuranceBrandRow, f"brand-{c.insurer_id}")
            if not b_existing:
                b_row = InsuranceBrandRow(
                    brand_id=f"brand-{c.insurer_id}",
                    insurer_id=c.insurer_id,
                    display_name=c.brand_name,
                    country=c.country,
                    primary_color_hex="#005BAC" if c.country == "CN" else "#003781",
                    website_url=c.official_website,
                )
                db.add(b_row)
                total_rows += 1

        db.flush()

        # Ingest Brand Assets
        for asset in brand_assets:
            existing = db.get(InsuranceBrandAssetRow, asset.asset_id)
            if not existing:
                row = InsuranceBrandAssetRow(
                    asset_id=asset.asset_id,
                    insurer_id=asset.insurer_id,
                    asset_type=asset.asset_type.value,
                    source_url=asset.source_url,
                    official_source_domain=asset.official_source_domain,
                    original_filename=asset.original_filename,
                    mime_type=asset.mime_type,
                    width=asset.width,
                    height=asset.height,
                    file_size_bytes=asset.file_size_bytes,
                    sha256=asset.sha256,
                    license_status=asset.license_status.value,
                    reuse_permission=asset.reuse_permission,
                    attribution_required=asset.attribution_required,
                    attribution_text=asset.attribution_text,
                    local_storage_path=asset.local_storage_path,
                    collection_date=asset.collection_date.isoformat(),
                    verification_status=asset.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        db.flush()

        # Ingest Products
        all_products = CN_PRODUCTS + ID_PRODUCTS
        for p in all_products:
            existing = db.get(InsuranceProductRow, p.product_id)
            if not existing:
                row = InsuranceProductRow(
                    product_id=p.product_id,
                    insurer_id=p.insurer_id,
                    original_product_name=p.original_product_name,
                    english_name=p.english_name,
                    product_category=p.product_category.value,
                    target_users={"users": p.target_users},
                    eligibility_conditions={"conditions": p.eligibility_conditions},
                    coverage_country=p.coverage_country,
                    coverage_territory=p.coverage_territory,
                    product_status=p.product_status,
                    currency=p.currency,
                    published_pricing=p.published_pricing,
                    published_pricing_conditions=p.published_pricing_conditions,
                    product_url=p.product_url,
                    verification_status=p.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        db.flush()

        # Ingest Benefits and Exclusions
        for p in all_products:
            for ben in p.benefits:
                b_existing = db.get(InsuranceBenefitRow, ben.benefit_id)
                if not b_existing:
                    b_row = InsuranceBenefitRow(
                        benefit_id=ben.benefit_id,
                        product_id=p.product_id,
                        benefit_category=ben.benefit_category,
                        benefit_name=ben.benefit_name,
                        original_name=ben.original_name,
                        covered_event=ben.covered_event,
                        covered_service=ben.covered_service,
                        inpatient_applicable=ben.inpatient_applicable,
                        outpatient_applicable=ben.outpatient_applicable,
                        benefit_limit=ben.benefit_limit,
                        sublimits=ben.sublimits,
                        currency=ben.currency,
                        period=ben.period,
                        network_requirements=ben.network_requirements,
                        reimbursement_rate=ben.reimbursement_rate,
                        preauthorization_required=ben.preauthorization_required,
                    )
                    db.add(b_row)
                    total_rows += 1

            for ex in p.exclusions:
                e_existing = db.get(InsuranceExclusionRow, ex.exclusion_id)
                if not e_existing:
                    e_row = InsuranceExclusionRow(
                        exclusion_id=ex.exclusion_id,
                        product_id=p.product_id,
                        excluded_event_or_service=ex.excluded_event_or_service,
                        original_text=ex.original_text,
                        conditions_and_exceptions=ex.conditions_and_exceptions,
                        waiting_period_days=ex.waiting_period_days,
                        deductible=ex.deductible,
                        copayment_percentage=ex.copayment_percentage,
                        coinsurance=ex.coinsurance,
                        excess=ex.excess,
                        pre_existing_condition_provisions=ex.pre_existing_condition_provisions,
                        supporting_policy_clause=ex.supporting_policy_clause,
                        source_page=ex.source_page,
                    )
                    db.add(e_row)
                    total_rows += 1

        db.flush()

        # Ingest Regulations
        all_regulations = CN_REGULATIONS + ID_REGULATIONS
        for r in all_regulations:
            existing = db.get(InsuranceRegulationRow, r.regulation_id)
            if not existing:
                row = InsuranceRegulationRow(
                    regulation_id=r.regulation_id,
                    country_code=r.country_code,
                    jurisdiction=r.jurisdiction,
                    issuing_authority=r.issuing_authority,
                    title_original=r.title_original,
                    title_english=r.title_english,
                    legal_reference_number=r.legal_reference_number,
                    category=r.category,
                    summary=r.summary,
                    key_provisions={"provisions": r.key_provisions},
                    applicable_population={"population": r.applicable_population},
                    source_url=r.source_url,
                    verification_status=r.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        # Ingest Public Schemes
        all_schemes = CN_PUBLIC_SCHEMES + ID_PUBLIC_SCHEMES
        for s in all_schemes:
            existing = db.get(InsurancePublicSchemeRow, s.scheme_id)
            if not existing:
                row = InsurancePublicSchemeRow(
                    scheme_id=s.scheme_id,
                    country_code=s.country_code,
                    jurisdiction=s.jurisdiction,
                    scheme_name_original=s.scheme_name_original,
                    scheme_name_english=s.scheme_name_english,
                    administrator=s.administrator,
                    membership_categories={"categories": s.membership_categories},
                    contribution_rules=s.contribution_rules,
                    benefit_summary={"summary": s.benefit_summary},
                    referral_requirements=s.referral_requirements,
                    source_url=s.source_url,
                    verification_status=s.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        # Ingest University Requirements
        for u in CN_UNIVERSITY_REQUIREMENTS:
            existing = db.get(UniversityInsuranceRequirementRow, u.requirement_id)
            if not existing:
                row = UniversityInsuranceRequirementRow(
                    requirement_id=u.requirement_id,
                    institution_id=u.institution_id,
                    institution_name=u.institution_name,
                    institution_name_original=u.institution_name_original,
                    city=u.city,
                    province=u.province,
                    country_code=u.country_code,
                    official_requirement_summary=u.official_requirement_summary,
                    eligible_student_categories={"categories": u.eligible_student_categories},
                    mandatory_purchase_required=u.mandatory_purchase_required,
                    approved_scheme_name=u.approved_scheme_name,
                    approved_insurer=u.approved_insurer,
                    policy_sources={"sources": u.policy_sources},
                    verification_status=u.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        # Ingest Claims Procedures
        all_procs = CN_CLAIM_PROCEDURES + ID_CLAIM_PROCEDURES
        for proc in all_procs:
            existing = db.get(InsuranceClaimProcedureRow, proc.procedure_id)
            if not existing:
                row = InsuranceClaimProcedureRow(
                    procedure_id=proc.procedure_id,
                    country_code=proc.country_code,
                    claims_administrator=proc.claims_administrator,
                    claim_types={"types": proc.claim_types},
                    submission_instructions=proc.submission_instructions,
                    filing_deadlines=proc.filing_deadlines,
                    required_forms={"forms": proc.required_forms},
                    submission_channels={"channels": proc.submission_channels},
                    official_portal_url=proc.official_portal_url,
                    reimbursement_procedures=proc.reimbursement_procedures,
                    published_processing_timeline=proc.published_processing_timeline,
                    customer_support_contact=proc.customer_support_contact,
                    source_url=proc.source_url,
                    verification_status=proc.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        # Ingest Claim Evidence
        all_evidence = CN_CLAIM_EVIDENCE + ID_CLAIM_EVIDENCE
        for ev in all_evidence:
            existing = db.get(InsuranceEvidenceRequirementRow, ev.evidence_id)
            if not existing:
                row = InsuranceEvidenceRequirementRow(
                    evidence_id=ev.evidence_id,
                    country_code=ev.country_code,
                    insurer_id=ev.insurer_id,
                    claim_type=ev.claim_type,
                    evidence_item_name=ev.evidence_item_name,
                    evidence_item_name_original=ev.evidence_item_name_original,
                    description=ev.description,
                    mandatory=ev.mandatory,
                    accepted_formats={"formats": ev.accepted_formats},
                    source_url=ev.source_url,
                    verification_status=ev.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        # Ingest Healthcare Providers
        all_providers = CN_HEALTHCARE_PROVIDERS + ID_HEALTHCARE_PROVIDERS
        for hp in all_providers:
            existing = db.get(HealthcareProviderRow, hp.provider_id)
            if not existing:
                row = HealthcareProviderRow(
                    provider_id=hp.provider_id,
                    country_code=hp.country_code,
                    name_original=hp.name_original,
                    name_english=hp.name_english,
                    city=hp.city,
                    facility_category=hp.facility_category,
                    facility_tier=hp.facility_tier,
                    address=hp.address,
                    official_contact=hp.official_contact,
                    emergency_service_available=hp.emergency_service_available,
                    source_url=hp.source_url,
                    verification_status=hp.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        # Ingest Medical Costs
        all_costs = CN_MEDICAL_COSTS + ID_MEDICAL_COSTS
        for mc in all_costs:
            existing = db.get(HealthcareCostReferenceRow, mc.cost_id)
            if not existing:
                row = HealthcareCostReferenceRow(
                    cost_id=mc.cost_id,
                    country_code=mc.country_code,
                    jurisdiction=mc.jurisdiction,
                    service_type=mc.service_type,
                    service_code=mc.service_code,
                    fee_reference_official=mc.fee_reference_official,
                    public_pricing=mc.public_pricing,
                    insurer_reimbursement_basis=mc.insurer_reimbursement_basis,
                    currency=mc.currency,
                    source_url=mc.source_url,
                    verification_status=mc.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        # Ingest Glossary
        for term in GLOBAL_GLOSSARY_ENTRIES:
            existing = db.get(InsuranceGlossaryRow, term.term_id)
            if not existing:
                row = InsuranceGlossaryRow(
                    term_id=term.term_id,
                    category=term.category,
                    simplified_chinese=term.simplified_chinese,
                    indonesian=term.indonesian,
                    english_display=term.english_display,
                    definition_en=term.definition_en,
                    definition_id=term.definition_id,
                    definition_zh=term.definition_zh,
                    authoritative_source=term.authoritative_source,
                )
                db.add(row)
                total_rows += 1

        # Ingest Deterministic Rules
        for r in DETERMINISTIC_RULES:
            existing = db.get(InsuranceEligibilityRuleRow, r.rule_id)
            if not existing:
                row = InsuranceEligibilityRuleRow(
                    rule_id=r.rule_id,
                    country_code=r.country_code,
                    jurisdiction=r.jurisdiction,
                    authority=r.authority,
                    rule_type=r.rule_type,
                    applicable_personas={"personas": r.applicable_personas},
                    applicability_conditions=r.applicability_conditions,
                    required_evidence={"evidence": r.required_evidence},
                    comparison_operator=r.comparison_operator,
                    threshold_or_condition=r.threshold_or_condition,
                    source_ids={"sources": r.source_ids},
                    verification_status=r.verification_status.value,
                )
                db.add(row)
                total_rows += 1

        # Record Collection Run Log
        run_row = DataCollectionRunRow(
            id=uuid4(),
            run_code=f"RUN-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}",
            country_scope="CN,ID",
            collector_name="INSURRA-Intelligence-Engine-v1.5",
            status="COMPLETED",
            records_collected=total_rows,
            records_verified=total_rows,
            errors_count=0,
            run_log={
                "sources": len(OFFICIAL_SOURCES),
                "assets": len(brand_assets),
                "exported_rows": total_rows,
            },
            completed_at=datetime.now(UTC),
        )
        db.add(run_row)
        total_rows += 1

        db.commit()
        return total_rows
