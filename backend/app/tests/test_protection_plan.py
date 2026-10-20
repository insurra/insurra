"""Adaptive profiling, separate health consent, and evidence-grounded product candidates."""

from app.tests.test_account_workspace import account_headers, grant


def id_profile(**changes):
    payload = {
        "display_name": "Raka",
        "residence_context": "DOMESTIC",
        "country_code": "ID",
        "occupation": "EMPLOYEE",
        "city": "Jakarta",
        "age_range": "25_34",
        "has_dependents": False,
        "has_existing_insurance": "NO",
        "owned_coverage": [],
        "priorities": ["find_gaps"],
        "financial_responsibilities": [],
        "health_sharing_preference": "PREFER_NOT_TO_ANSWER",
    }
    payload.update(changes)
    return payload


def finding(response, code):
    return next(item for item in response.json()["findings"] if item["code"] == code)


def test_health_profile_is_denied_by_default_and_revocation_deletes_sensitive_fields(app, client):
    headers = account_headers(app, "health-consent")
    consents = client.get("/api/v1/account/consents", headers=headers).json()["consents"]
    health = next(item for item in consents if item["purpose"] == "health_profile")
    assert health["granted"] is False

    body = id_profile(
        health_sharing_preference="SHARE_RELEVANT",
        ongoing_healthcare_needs=["REGULAR_MEDICATION_ACCESS"],
        medication_access_needs="Recurring prescription access",
    )
    blocked = client.put("/api/v1/account/profile", headers=headers, json=body)
    assert blocked.status_code == 403
    assert blocked.json()["details"]["required_purposes"] == ["health_profile"]

    grant(client, headers, "health_profile")
    assert client.put("/api/v1/account/profile", headers=headers, json=body).status_code == 200
    grant(client, headers, "health_profile", False)
    stored = client.get("/api/v1/account/profile", headers=headers).json()["profile"]
    assert stored["ongoing_healthcare_needs"] == []
    assert stored["medication_access_needs"] is None


def test_baseline_plan_works_without_document_or_health_consent_and_uses_catalog_only(app, client):
    headers = account_headers(app, "baseline-plan")
    assert (
        client.put("/api/v1/account/profile", headers=headers, json=id_profile()).status_code == 200
    )

    response = client.get("/api/v1/protection-plan", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["document_evidence_used"] is False
    assert payload["health_profile_used"] is False
    assert finding(response, "core_medical")["status"] == "POTENTIAL_GAP"
    assert {item["product_id"] for item in payload["product_candidates"]} == {
        "id-prod-allianz-preferred-medical",
        "id-prod-prudential-prusehat",
        "id-prod-manulife-miultimate",
    }
    assert all(
        item["official_source_url"].startswith("https://") for item in payload["product_candidates"]
    )
    assert all(
        item["verification_status"] == "UNVERIFIED" for item in payload["product_candidates"]
    )
    assert all(item["eligibility"] == "UNKNOWN" for item in payload["product_candidates"])


def test_profile_change_changes_needs_and_self_reported_cover_stays_unverified(app, client):
    headers = account_headers(app, "profile-change")
    assert (
        client.put("/api/v1/account/profile", headers=headers, json=id_profile()).status_code == 200
    )
    before = client.get("/api/v1/protection-plan", headers=headers)
    assert not any(item["code"] == "dependent_protection" for item in before.json()["findings"])

    changed = id_profile(
        has_dependents=True,
        dependents=["Children"],
        dependent_age_groups=["CHILD"],
        owned_coverage=["Private Health"],
        has_existing_insurance="YES",
    )
    assert client.put("/api/v1/account/profile", headers=headers, json=changed).status_code == 200
    after = client.get("/api/v1/protection-plan", headers=headers)
    assert finding(after, "dependent_protection")["status"] == "POTENTIAL_GAP"
    assert finding(after, "core_medical")["status"] == "NEEDS_VERIFICATION"
