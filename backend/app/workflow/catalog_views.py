"""Catalog services for Employer Benefits (SC-15) and Product Comparison (SC-17).

Provides verified source data for China and Indonesia without fabricating coverage, coordination,
or pricing guarantees.
"""

from app.workflow import kbdata
from app.workflow.owner import Owner


def get_employer_benefits_overview(
    country_code: str, owner: Owner | None = None, policies: list | None = None
) -> dict:
    code = kbdata.require_country(country_code)
    schemes = kbdata.raw(code, "insurance_schemes")

    # Statutory schemes
    statutory_items = []
    for s in schemes:
        if isinstance(s, dict):
            statutory_items.append(
                {
                    "scheme_id": s.get("scheme_id"),
                    "name": s.get("scheme_name") or s.get("name"),
                    "category": "Statutory Social Insurance",
                    "coverage_scope": s.get("scope_of_coverage") or s.get("description"),
                    "eligibility": s.get("eligibility_criteria") or s.get("eligibility"),
                    "mandatory_status": s.get("mandatory_status") or "Statutory requirement",
                    "funding_mechanism": s.get("funding_mechanism"),
                    "official_reference": s.get("source_url") or s.get("governing_law"),
                }
            )

    # Employer group products from catalog
    products = kbdata.products(code)
    group_products = [
        p for p in products if p.get("product_category") in ("employer_group", "group")
    ]

    # Declared user policies if available
    user_declared = []
    if policies is not None:
        for pol in policies:
            user_declared.append(
                {
                    "ref": pol.ref,
                    "provider": pol.provider or "Declared Provider",
                    "kind": pol.kind,
                    "name": pol.name or pol.kind,
                    "is_employer_group": pol.kind in ("EMPLOYER", "GROUP", "EMPLOYER_GROUP"),
                    "start": pol.start,
                    "end": pol.end,
                    "verification": pol.verification,
                }
            )

    # Coordination rules summary
    if code == "CN":
        coordination_summary = {
            "statutory_role": "Primary (National Basic Medical Insurance typically pays first for eligible public hospital care)",
            "employer_supplementary_role": "Secondary / Supplementary (Covers copayments, deductibles, or commercial riders subject to policy terms)",
            "personal_commercial_role": "Supplementary or High-Cost Protection (Million-RMB medical or critical illness for non-covered items)",
            "coordination_rule": "Deterministic coordination depends on whether the hospital invoice underwent basic medical insurance settlement (医保统筹支付). Do not assume private insurance pays without official fapiao settlement split.",
            "notice": "Coordination status depends on specific enterprise contract and local social security bureau rules.",
        }
    else:  # ID
        coordination_summary = {
            "statutory_role": "Primary / Standalone (BPJS Kesehatan / JKN operates through tiered FKTP referral system, not direct private reimbursement)",
            "employer_supplementary_role": "Coordination of Benefit (COB) or Independent Commercial Tier (Subject to hospital partnership and insurer COB agreement)",
            "personal_commercial_role": "Private Commercial / Cashless Network or Inpatient Top-up",
            "coordination_rule": "Under Indonesian regulations (Permenkes 16/2017 & BPJS guidelines), COB requires formal agreements between BPJS and private insurers. Never automatically assume primary/secondary order without policy endorsement.",
            "notice": "JKN and private commercial policies operate under separate claim pathways unless explicitly linked via COB.",
        }

    return {
        "country_code": code,
        "statutory_schemes": statutory_items,
        "group_catalog_products": [
            {
                "product_id": p.get("product_id"),
                "name": p.get("english_name") or p.get("original_product_name"),
                "insurer_id": p.get("insurer_id"),
                "coverage_territory": p.get("coverage_territory"),
                "target_users": p.get("target_users", []),
                "published_pricing": p.get("published_pricing"),
                "source_url": p.get("product_url"),
            }
            for p in group_products
        ],
        "user_declared_policies": user_declared,
        "coordination_principles": coordination_summary,
        "recommended_documentation": [
            "Employer Group Health Benefits Certificate / Employee Handbook Schedule",
            "Social Security Registration / National Health Card (BPJS / 医保卡)",
            "Official Certificate of Employment or Dependent Declaration (if family members are covered)",
        ],
    }


def compare_products(
    country_code: str,
    product_category: str | None = None,
    user_segment: str | None = None,
    insurer_id: str | None = None,
    product_ids: list[str] | None = None,
) -> dict:
    code = kbdata.require_country(country_code)
    all_products = kbdata.products(code)
    companies_map = {c.get("insurer_id"): c for c in kbdata.companies(code)}

    filtered = []
    for p in all_products:
        if product_ids and p.get("product_id") not in product_ids:
            continue
        if product_category and p.get("product_category") != product_category:
            continue
        if insurer_id and p.get("insurer_id") != insurer_id:
            continue
        if user_segment:
            targets = [t.casefold() for t in p.get("target_users", [])]
            if not any(user_segment.casefold() in t for t in targets):
                continue
        filtered.append(p)

    comparison_items = []
    for p in filtered:
        ins = companies_map.get(p.get("insurer_id"), {})

        # Summarize benefits
        benefits_summary = []
        for b in p.get("benefits", []):
            benefits_summary.append(
                {
                    "benefit_name": b.get("benefit_name"),
                    "limit": b.get("benefit_limit"),
                    "currency": b.get("currency"),
                    "period": b.get("period"),
                    "covered_service": b.get("covered_service"),
                }
            )

        # Summarize exclusions
        exclusions_summary = []
        for e in p.get("exclusions", []):
            exclusions_summary.append(
                {
                    "excluded_event": e.get("excluded_event_or_service"),
                    "conditions": e.get("conditions_and_exceptions"),
                    "waiting_period_days": e.get("waiting_period_days"),
                }
            )

        comparison_items.append(
            {
                "product_id": p.get("product_id"),
                "insurer_id": p.get("insurer_id"),
                "insurer_name": ins.get("brand_name")
                or ins.get("legal_entity_name")
                or p.get("insurer_id"),
                "insurer_logo_asset": (ins.get("brand_asset_ids") or [None])[0],
                "product_name": p.get("english_name") or p.get("original_product_name"),
                "original_product_name": p.get("original_product_name"),
                "product_category": p.get("product_category"),
                "product_version": p.get("product_version") or "Current",
                "effective_period": (
                    f"{p.get('effective_from', '')} to {p.get('effective_to', '')}".strip()
                    if (p.get("effective_from") or p.get("effective_to"))
                    else "Ongoing"
                ),
                "eligibility_conditions": p.get("eligibility_conditions", []),
                "coverage_territory": p.get("coverage_territory"),
                "published_pricing": p.get("published_pricing"),
                "published_pricing_conditions": p.get("published_pricing_conditions")
                or "Price subject to underwriting and age tier",
                "pricing_available": bool(p.get("published_pricing")),
                "benefits": benefits_summary,
                "exclusions": exclusions_summary,
                "source_url": p.get("product_url"),
                "verification_status": p.get("verification_status", "VERIFIED"),
                "disclaimer": "Informational comparison only. INSURRA does not sell policies, bind coverage, or receive commissions.",
            }
        )

    return {
        "country_code": code,
        "total_available": len(all_products),
        "total_matched": len(comparison_items),
        "active_categories": sorted(
            list({p.get("product_category") for p in all_products if p.get("product_category")})
        ),
        "products": comparison_items,
        "commission_disclosure": {
            "has_broker_commission": False,
            "objective_ranking_note": "INSURRA has zero commercial affiliation with listed insurers and does not receive referral fees or commissions.",
        },
    }
