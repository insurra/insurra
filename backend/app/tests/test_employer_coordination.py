"""Tests for SC-15 Employer Benefits coordination and SC-17 Product Comparison provenance (B1.2, B7.2, B7.3)."""


def test_employer_benefits_sinta_keeps_jkn_and_employer_separate_with_unknown_coordination(
    client, demo
):
    _, headers = demo("sinta")
    res = client.get("/api/v1/workflow/employer-benefits/overview?country_code=ID", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["country_code"] == "ID"
    assert data["coordination"] == "UNKNOWN"
    assert data["coordination_evidence_ref"] is None
    assert data["coordination_principles"]["coordination"] == "UNKNOWN"
    policies = data["user_declared_policies"]
    kinds = {p["kind"] for p in policies}
    assert "BPJS" in kinds and "EMPLOYER" in kinds
    assert all(p["coordination"] == "UNKNOWN" for p in policies)


def test_product_comparison_defaults_to_unverified_without_retrieved_artifact(client):
    for country in ("CN", "ID"):
        res = client.get(f"/api/v1/workflow/products/compare?country_code={country}")
        assert res.status_code == 200
        body = res.json()
        assert body["country_code"] == country
        assert body["commission_disclosure"] is None
        assert len(body["products"]) >= 1
        for prod in body["products"]:
            assert prod["verification_status"] == "UNVERIFIED"
            assert prod["evidence_class"] == "MANUALLY_CURATED"
            assert prod["provenance"]["verification_status"] == "UNVERIFIED"
            assert prod["provenance_note"]
            assert prod["insurer_logo_asset"] is None


def test_employer_benefits_overview_returns_complete_intelligence(client, demo):
    _, headers = demo("sinta")
    res = client.get("/api/v1/workflow/employer-benefits/overview", headers=headers)
    assert res.status_code == 200
    data = res.json()

    # REG-53: Policy and eligibility overview
    assert data["company_name"] == "PT Teknologi Maju"
    assert data["plan_name"] == "MajuCare Plus"
    assert data["insurer_name"] == "Allianz Indonesia"
    assert data["coverage_score_percent"] == 80
    assert data["coverage_status_label"] == "Well covered"

    # REG-54 & REG-55: Categories, limits, utilization (never fabricated)
    benefits = data["key_benefits"]
    categories = {b["benefit_category"] for b in benefits}
    assert {"inpatient", "outpatient", "dental", "optical", "maternity", "emergency"}.issubset(
        categories
    )

    # Inpatient verified utilization
    inpatient = next(b for b in benefits if b["benefit_category"] == "inpatient")
    assert inpatient["coverage_status"] == "Covered"
    assert inpatient["used_amount"] == "IDR 120,000,000"
    assert inpatient["available_balance"] == "IDR 380,000,000"
    assert inpatient["utilization_status"] == "VERIFIED"

    # Dental has unverified utilization -> Must be Unknown, never fabricated
    dental = next(b for b in benefits if b["benefit_category"] == "dental")
    assert dental["coverage_status"] == "Partial"
    assert dental["used_amount"] == "Unknown"
    assert dental["available_balance"] == "Unknown"
    assert dental["utilization_status"] == "UNKNOWN"

    # REG-56 & REG-57: Benefit comparison and coordination overlap
    assert len(data["overlaps"]) >= 2
    inpatient_overlap = next(o for o in data["overlaps"] if o["category"].lower() == "inpatient")
    assert inpatient_overlap["coordination_status"] in ("POTENTIAL_OVERLAP", "PRIMARY")
    assert "BPJS" in (inpatient_overlap["public_coverage"] or "")

    # REG-58: Cashless and reimbursement procedures
    assert data["claim_procedure"]["cashless"] is True
    assert data["claim_procedure"]["reimbursement"] is True

    # REG-59: Continuity & eligibility issues after employment changes
    assert len(data["continuity_issues"]) >= 1
    assert any(ci["issue_type"] == "EMPLOYMENT_TERMINATION" for ci in data["continuity_issues"])

    # REG-60: Evidence-based benefit usage guidance
    assert len(data["ai_guidance"]) >= 3


def test_employer_benefits_save_and_manual_entry(client, demo):
    _, headers = demo("sinta")
    payload = {
        "company_name": "PT Maju Bersama",
        "employment_status": "Full-time employee",
        "employment_start_date": "2024-01-01",
        "employment_end_date": "Present",
        "plan_name": "Corporate Health Shield",
        "insurer_name": "Allianz Indonesia",
        "policy_number": "POL-998877",
        "eligible_dependents": ["Self (employee)", "Spouse"],
        "claim_procedure_cashless": True,
        "claim_procedure_reimbursement": True,
        "verification_status": "SELF_REPORTED",
        "benefits": [
            {
                "benefit_category": "inpatient",
                "coverage_status": "Covered",
                "limit_amount": "IDR 300,000,000 / year",
                "limit_numeric": 300000000.0,
                "used_amount": "Unknown",
                "used_numeric": None,
                "available_balance": "Unknown",
                "available_numeric": None,
                "details": "Private room",
                "utilization_status": "UNKNOWN",
            }
        ],
    }

    save_res = client.post("/api/v1/workflow/employer-benefits", json=payload, headers=headers)
    assert save_res.status_code == 200
    saved = save_res.json()
    assert saved["company_name"] == "PT Maju Bersama"
    assert saved["plan_name"] == "Corporate Health Shield"
    assert saved["has_custom_data"] is True


def test_employer_benefits_extract_document(client):
    fake_file_content = (
        b"PT Teknologi Maju Group Health Insurance Policy Schedule Allianz Indonesia"
    )
    files = {"file": ("PTM_BenefitGuide_2026.pdf", fake_file_content, "application/pdf")}
    res = client.post("/api/v1/workflow/employer-benefits/extract-document", files=files)
    assert res.status_code == 200
    extracted = res.json()
    assert extracted["company_name"] == "PT Teknologi Maju"
    assert extracted["plan_name"] == "Group Health Insurance"
    assert len(extracted["benefits"]) >= 4


def test_regular_user_and_raka_have_no_injected_employer_benefits(client, demo):
    """Zero hardcoding constraint: only demo persona Sinta is injected with default employer benefits.

    Regular authenticated accounts or demo persona Raka without custom data start with no employer
    coverage.
    """
    _, raka_headers = demo("raka")
    res = client.get("/api/v1/workflow/employer-benefits/overview", headers=raka_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["has_employer_coverage"] is False
    assert data["company_name"] == ""
    assert data["plan_name"] == ""
    assert data["coverage_score_percent"] == 0
    assert len(data["key_benefits"]) == 0
    assert len(data["overlaps"]) == 0
    assert data["has_custom_data"] is False
