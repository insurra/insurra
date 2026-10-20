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
