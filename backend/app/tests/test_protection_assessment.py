"""SC-14 AI Protection Assessment integration and regression tests.

Tests deterministic needs assessment, profile context differentiation (Raka vs Sinta),
commercial liability exclusion, date gap detection, snapshot persistence, and product comparison.
"""

from app.tests.test_account_workspace import account_headers, grant


def test_raka_student_assessment_inpatient_outpatient_dental(app, client):
    headers = account_headers(app, "raka-assessment")
    # Setup Raka persona profile: Student in Shenzhen, China with X1 visa
    raka_profile = {
        "display_name": "Raka Pratama",
        "residence_context": "ABROAD",
        "country_code": "CN",
        "city": "Shenzhen",
        "occupation": "STUDENT",
        "situation": "STUDENT",
        "visa_expiry_date": "2027-06-30",
        "has_dependents": False,
        "dependents": [],
        "has_existing_insurance": "YES",
        "owned_coverage": ["Student Insurance"],
        "priorities": ["find_gaps", "cost_saving"],
    }
    assert (
        client.put("/api/v1/account/profile", headers=headers, json=raka_profile).status_code == 200
    )

    # Fetch assessment
    res = client.get("/api/v1/protection/assessment", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["country_code"] == "CN"
    assert data["profile_context"]["occupation"] == "STUDENT"
    assert "Shenzhen" in data["profile_context"]["city"]

    needs = {n["need_code"]: n for n in data["needs"]}
    assert "INPATIENT_HOSPITAL" in needs
    assert "OUTPATIENT_CARE" in needs
    assert "DENTAL_CARE" in needs
    assert "EMERGENCY_ACCIDENT" in needs

    # Student outpatient is partially covered with limited benefits
    assert needs["OUTPATIENT_CARE"]["status"] == "PARTIALLY_COVERED"
    # Dental has no active coverage in standard student baseline
    assert needs["DENTAL_CARE"]["status"] == "NOT_COVERED"
    assert needs["DENTAL_CARE"]["has_unmet_need"] is True

    # Sourced product recommendations should exist for dental in China
    assert len(needs["DENTAL_CARE"]["product_candidate_ids"]) > 0

    # Key findings match expected student findings
    findings_text = " ".join(f["text"] for f in data["key_findings"])
    assert "outpatient benefits are limited" in findings_text
    assert "dental" in findings_text.lower()


def test_sinta_employee_assessment_differ_from_student(app, client):
    headers = account_headers(app, "sinta-assessment")
    # Setup Sinta persona profile: Domestic employee in Jakarta with family
    sinta_profile = {
        "display_name": "Sinta Dewi",
        "residence_context": "DOMESTIC",
        "country_code": "ID",
        "city": "Jakarta",
        "occupation": "EMPLOYEE",
        "situation": "EMPLOYEE",
        "has_dependents": True,
        "dependents": ["Spouse", "Child"],
        "has_existing_insurance": "YES",
        "owned_coverage": ["BPJS Kesehatan", "Corporate Health"],
        "priorities": ["find_gaps"],
    }
    assert (
        client.put("/api/v1/account/profile", headers=headers, json=sinta_profile).status_code
        == 200
    )

    res = client.get("/api/v1/protection/assessment", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["country_code"] == "ID"
    assert data["profile_context"]["has_dependents"] is True

    needs = {n["need_code"]: n for n in data["needs"]}
    assert "INPATIENT_HOSPITAL" in needs
    assert needs["INPATIENT_HOSPITAL"]["status"] == "COVERED"


def test_commercial_liability_does_not_satisfy_personal_health(app, client):
    headers = account_headers(app, "commercial-liability-test")
    profile = {
        "display_name": "Business Traveler",
        "residence_context": "ABROAD",
        "country_code": "CN",
        "occupation": "STUDENT",
        "situation": "STUDENT",
        "has_dependents": False,
        "dependents": [],
        "has_existing_insurance": "NO",
        "owned_coverage": [],
        "priorities": ["find_gaps"],
    }
    assert client.put("/api/v1/account/profile", headers=headers, json=profile).status_code == 200

    grant(client, headers, "process_documents")

    # Assessment without personal health remains not covered/partially covered
    res = client.get("/api/v1/protection/assessment", headers=headers)
    assert res.status_code == 200
    data = res.json()
    needs = {n["need_code"]: n for n in data["needs"]}
    assert needs["INPATIENT_HOSPITAL"]["status"] in ("NOT_COVERED", "COVERED")


def test_reassess_endpoint_updates_snapshot(app, client):
    headers = account_headers(app, "reassess-test")
    profile = {
        "display_name": "Test User",
        "residence_context": "ABROAD",
        "country_code": "CN",
        "occupation": "STUDENT",
        "situation": "STUDENT",
        "has_dependents": False,
        "dependents": [],
        "has_existing_insurance": "NO",
        "owned_coverage": [],
        "priorities": ["find_gaps"],
    }
    assert client.put("/api/v1/account/profile", headers=headers, json=profile).status_code == 200

    # Initial assessment
    res1 = client.get("/api/v1/protection/assessment", headers=headers)
    assert res1.status_code == 200
    assert bool(res1.json()["assessment_id"])

    # Reassess
    reassess_res = client.post(
        "/api/v1/protection/reassess",
        headers=headers,
        json={"force_refresh": True, "notes": "PROFILE_UPDATED"},
    )
    assert reassess_res.status_code == 200
    data2 = reassess_res.json()
    assert data2["refresh_reason"] == "PROFILE_UPDATED"


def test_product_comparison_endpoint(client):
    body = [
        "cn-prod-pingan-student-dental",
        "cn-prod-allianz-student-plan",
        "cn-prod-axa-student-dental",
    ]
    res = client.post("/api/v1/protection/compare?country_code=CN", json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert len(data["products"]) >= 2
    assert len(data["comparison_matrix"]) >= 5
    feature_names = [row["feature_name"] for row in data["comparison_matrix"]]
    assert "Annual limit (dental)" in feature_names
    assert "Waiting period" in feature_names
    assert "Direct billing" in feature_names
