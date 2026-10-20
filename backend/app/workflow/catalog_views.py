"""Catalog services for Employer Benefits (SC-15) and Product Comparison (SC-17).

Provides source-aware catalog data for China and Indonesia without fabricating coverage,
benefit coordination, or pricing guarantees.
"""

from app.workflow import kbdata
from app.workflow.owner import Owner


def _is_retrieved_official(record: dict) -> bool:
    return (
        record.get("verification_status") == "VERIFIED"
        and record.get("evidence_class") == "RETRIEVED_OFFICIAL"
        and bool(record.get("retrieval_artifact_sha256"))
    )


def _provenance(record: dict, kb_country: str, kb_file: str, record_id: str | None) -> dict:
    verified = _is_retrieved_official(record)
    return {
        "origin": "KB_PUBLIC",
        "evidence_ref": {
            "kb_country": kb_country,
            "kb_file": kb_file,
            "record_id": record_id,
        },
        "verification_status": "VERIFIED" if verified else "UNVERIFIED",
        "evidence_class": record.get("evidence_class") or "MANUALLY_CURATED",
        "source_url": record.get("product_url") or record.get("source_url"),
        "provenance_note": record.get("provenance_note")
        or "Curated public catalog summary; not independently verified against an official filing.",
    }


def get_employer_benefits_overview(
    country_code: str, owner: Owner | None = None, policies: list | None = None
) -> dict:
    code = kbdata.require_country(country_code)
    schemes = kbdata.raw(code, "insurance_schemes")

    statutory_items = []
    for s in schemes:
        if isinstance(s, dict):
            verified = _is_retrieved_official(s)
            statutory_items.append(
                {
                    "scheme_id": s.get("scheme_id"),
                    "name": s.get("scheme_name") or s.get("name"),
                    "category": "Statutory Social Insurance",
                    "coverage_scope": s.get("scope_of_coverage") or s.get("description"),
                    "eligibility": s.get("eligibility_criteria") or s.get("eligibility"),
                    "mandatory_status": s.get("mandatory_status")
                    if verified
                    else "Requires verification",
                    "funding_mechanism": s.get("funding_mechanism"),
                    "official_reference": s.get("source_url"),
                    "verification_status": "VERIFIED" if verified else "UNVERIFIED",
                    "evidence_class": s.get("evidence_class") or "MANUALLY_CURATED",
                    "provenance_note": s.get("provenance_note"),
                }
            )

    products = kbdata.products(code)
    group_products = [
        p for p in products if p.get("product_category") in ("employer_group", "group")
    ]

    user_declared = []
    if policies is not None:
        for pol in policies:
            evidence_ref = (
                {"document_id": pol.source_document_ids[0]}
                if getattr(pol, "source_document_ids", None)
                and getattr(pol, "verification", "UNVERIFIED") == "VERIFIED"
                else None
            )
            user_declared.append(
                {
                    "ref": pol.ref,
                    "provider": pol.provider,
                    "kind": pol.kind,
                    "name": pol.name or pol.kind,
                    "is_employer_group": pol.kind in ("EMPLOYER", "GROUP", "EMPLOYER_GROUP"),
                    "start": pol.start,
                    "end": pol.end,
                    "verification": pol.verification,
                    "coordination": "UNKNOWN",
                    "evidence_ref": evidence_ref,
                }
            )

    coordination_summary = {
        "coordination": "UNKNOWN",
        "evidence_ref": None,
        "statutory_role": "Unknown until verified from scheme membership and hospital settlement records",
        "employer_supplementary_role": "Unknown until verified from employer group policy schedule or HR endorsement",
        "personal_commercial_role": "Unknown until verified from individual policy wording",
        "coordination_rule": (
            "Coordination of benefits (primary vs secondary payer order) is unknown unless "
            "supported by verified policy endorsements and provider billing agreements."
        ),
        "notice": (
            "Statutory schemes and employer group policies are kept separate. "
            "INSURRA never assumes automatic benefit coordination or combined limits without source evidence."
        ),
    }

    return {
        "country_code": code,
        "coordination": "UNKNOWN",
        "coordination_evidence_ref": None,
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
                "verification_status": "VERIFIED" if _is_retrieved_official(p) else "UNVERIFIED",
                "evidence_class": p.get("evidence_class", "MANUALLY_CURATED"),
                "provenance_note": p.get("provenance_note"),
            }
            for p in group_products
        ],
        "user_declared_policies": user_declared,
        "coordination_principles": coordination_summary,
        "recommended_documentation": [
            "Employer Group Health Benefits Certificate or Schedule of Benefits",
            "National / Social Health Insurance Membership Card",
            "HR Benefits Clarification or Coordination Endorsement",
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
        prod_id = p.get("product_id")
        prov = _provenance(p, code, "products.json", prod_id)
        verified = _is_retrieved_official(p)
        status = "VERIFIED" if verified else "UNVERIFIED"

        benefits_summary = []
        for b in p.get("benefits", []):
            benefits_summary.append(
                {
                    "benefit_name": b.get("benefit_name"),
                    "limit": b.get("benefit_limit"),
                    "currency": b.get("currency"),
                    "period": b.get("period"),
                    "covered_service": b.get("covered_service"),
                    "waiting_period_days": b.get("waiting_period_days"),
                    "provenance": prov,
                }
            )

        exclusions_summary = []
        for e in p.get("exclusions", []):
            exclusions_summary.append(
                {
                    "excluded_event": e.get("excluded_event_or_service"),
                    "conditions": e.get("conditions_and_exceptions"),
                    "waiting_period_days": e.get("waiting_period_days"),
                    "provenance": prov,
                }
            )

        effective_from = p.get("effective_from")
        effective_to = p.get("effective_to")
        effective_period = (
            f"{effective_from or ''} to {effective_to or ''}".strip()
            if (effective_from or effective_to)
            else None
        )
        display_name = p.get("english_name") or p.get("original_product_name")
        orig_name = p.get("original_product_name")
        pricing = p.get("published_pricing")

        comparison_items.append(
            {
                "product_id": prod_id,
                "insurer_id": p.get("insurer_id"),
                "insurer_name": ins.get("brand_name")
                or ins.get("legal_entity_name")
                or p.get("insurer_id"),
                "insurer_logo_asset": None,
                "name": display_name,
                "product_name": display_name,
                "original_name": orig_name,
                "original_product_name": orig_name,
                "product_category": p.get("product_category"),
                "product_version": p.get("product_version"),
                "effective_period": effective_period,
                "target_users": p.get("target_users", []),
                "eligibility_conditions": p.get("eligibility_conditions", []),
                "coverage_territory": p.get("coverage_territory"),
                "published_pricing": pricing if isinstance(pricing, dict) else None,
                "published_pricing_text": pricing if isinstance(pricing, str) else None,
                "published_pricing_conditions": p.get("published_pricing_conditions"),
                "pricing_available": bool(pricing),
                "benefits": benefits_summary,
                "exclusions": exclusions_summary,
                "source_url": p.get("product_url"),
                "verification_status": status,
                "evidence_class": p.get("evidence_class", "MANUALLY_CURATED"),
                "provenance_note": prov["provenance_note"],
                "provenance": prov,
                "attributes": {
                    "coverage_territory": {
                        "value": p.get("coverage_territory"),
                        "provenance": prov,
                    },
                    "product_version": {
                        "value": p.get("product_version"),
                        "provenance": prov,
                    },
                    "published_pricing": {
                        "value": pricing,
                        "provenance": prov,
                    },
                },
                "disclaimer": (
                    "Informational catalog comparison only. Catalog records are not owned user "
                    "coverage and do not guarantee eligibility, pricing, or claim outcomes."
                ),
            }
        )

    categories = sorted(
        list({p.get("product_category") for p in all_products if p.get("product_category")})
    )
    return {
        "country_code": code,
        "total_available": len(all_products),
        "total_products": len(all_products),
        "total_matched": len(comparison_items),
        "active_categories": categories,
        "categories": categories,
        "products": comparison_items,
        "commission_disclosure": None,
    }
