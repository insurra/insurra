"""Tests for Family Protection Intelligence (SC-18, REG-61 to REG-66)."""

from uuid import uuid4

from fastapi.testclient import TestClient

from app.models.auth import AccountRow, AccountSessionRow


def test_sinta_demo_family_overview(client: TestClient):
    # Start Sinta demo session
    res = client.post("/api/v1/demo/sessions", json={"persona_id": "sinta"})
    assert res.status_code == 201, res.text
    data = res.json()
    token = data["session_token"]
    headers = {"X-Demo-Session": token}

    # Fetch family protection overview
    ov_res = client.get("/api/v1/family/overview", headers=headers)
    assert ov_res.status_code == 200, ov_res.text
    overview = ov_res.json()

    summary = overview["summary"]
    assert summary["total_members"] == 4
    assert summary["covered_count"] == 3
    assert summary["partial_count"] == 1
    assert summary["not_covered_count"] == 0
    assert summary["unknown_count"] == 0
    assert summary["coverage_score_percent"] == 75
    assert summary["headline"] == "Mostly covered"

    members = overview["members"]
    assert len(members) == 4

    # Member names
    names = [m["name"] for m in members]
    assert "Sinta Dewi" in names
    assert "Andi" in names
    assert "Alya" in names
    assert "Bima" in names

    # Inspect Alya (Child - 6 years)
    alya = next(m for m in members if m["name"] == "Alya")
    assert alya["relation"] == "Child"
    assert alya["age"] == 6
    assert alya["coverage_status"] == "PARTIAL"
    assert len(alya["linked_policies"]) == 1
    assert "PT Teknologi Maju" in alya["linked_policies"][0]["policy_name"]

    # Inspect Alya's benefits
    benefits_by_key = {b["benefit_key"]: b for b in alya["benefits"]}
    assert benefits_by_key["inpatient"]["status"] == "COVERED"
    assert benefits_by_key["outpatient"]["status"] == "COVERED"
    assert benefits_by_key["dental"]["status"] == "NOT_COVERED"
    assert benefits_by_key["optical"]["status"] == "PARTIAL"
    assert benefits_by_key["maternity"]["status"] == "NOT_APPLICABLE"
    assert benefits_by_key["emergency"]["status"] == "COVERED"

    # Inspect Alya's unmet needs & AI insights
    assert any("dental" in n["title"].lower() for n in alya["unmet_needs"])
    assert any("dental" in ins["title"].lower() for ins in alya["ai_insights"])
    assert any("optical" in ins["title"].lower() for ins in alya["ai_insights"])

    # Inspect Alya's eligibility rules
    age_rule = next(r for r in alya["eligibility_rules"] if "age" in r["rule_name"].lower())
    assert age_rule["status"] == "ELIGIBLE"


def test_raka_demo_family_overview(client: TestClient):
    # Start Raka demo session
    res = client.post("/api/v1/demo/sessions", json={"persona_id": "raka"})
    assert res.status_code == 201, res.text
    token = res.json()["session_token"]
    headers = {"X-Demo-Session": token}

    ov_res = client.get("/api/v1/family/overview", headers=headers)
    assert ov_res.status_code == 200, ov_res.text
    overview = ov_res.json()
    assert overview["summary"]["total_members"] == 1
    assert overview["members"][0]["name"] == "Raka Pratama"
    assert overview["members"][0]["coverage_status"] == "COVERED"


def test_account_family_crud_and_policy_linking(client: TestClient, db_session):
    import hashlib
    from datetime import UTC, datetime, timedelta

    account_id = uuid4()
    token = f"test-token-{uuid4().hex}"
    now = datetime.now(UTC)
    acc = AccountRow(
        id=account_id,
        email=f"user-{account_id.hex[:6]}@example.com",
        created_at=now,
        updated_at=now,
    )
    db_session.add(acc)
    sess = AccountSessionRow(
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        account_id=account_id,
        created_at=now,
        expires_at=now + timedelta(days=7),
    )
    db_session.add(sess)
    db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}

    # 1. Overview initially creates primary user
    ov_res = client.get("/api/v1/family/overview", headers=headers)
    assert ov_res.status_code == 200
    ov = ov_res.json()
    assert len(ov["members"]) == 1
    assert ov["members"][0]["is_primary"] is True

    # 2. Add dependent child
    add_res = client.post(
        "/api/v1/family/members",
        headers=headers,
        json={
            "name": "Kiki Pratama",
            "relation": "Child",
            "birth_date": "2019-07-15",
            "gender": "Male",
            "consent_confirmed": True,
        },
    )
    assert add_res.status_code == 201, add_res.text
    kiki = add_res.json()
    assert kiki["name"] == "Kiki Pratama"
    assert kiki["relation"] == "Child"
    assert kiki["coverage_status"] == "NOT_COVERED"

    kiki_id = kiki["id"]

    # 2b. Attempt to add another Primary (self) member must fail with 400
    dup_primary_res = client.post(
        "/api/v1/family/members",
        headers=headers,
        json={
            "name": "Another Self",
            "relation": "Primary",
            "consent_confirmed": True,
        },
    )
    assert dup_primary_res.status_code == 400, dup_primary_res.text
    assert "PRIMARY_MEMBER_ALREADY_EXISTS" in dup_primary_res.text

    # 2c. Attempt to add duplicate member name must fail with 400
    dup_name_res = client.post(
        "/api/v1/family/members",
        headers=headers,
        json={
            "name": "Kiki Pratama",
            "relation": "Child",
            "consent_confirmed": True,
        },
    )
    assert dup_name_res.status_code == 400, dup_name_res.text
    assert "DUPLICATE_MEMBER" in dup_name_res.text

    # 3. Link policy to Kiki
    link_res = client.post(
        f"/api/v1/family/members/{kiki_id}/policies",
        headers=headers,
        json={
            "policy_ref": "pol-kiki-001",
            "policy_name": "Family Shield Gold",
            "provider_name": "Prudential",
            "policy_type": "PRIVATE",
            "coverage_role": "CHILD",
            "status": "ACTIVE",
            "verification_status": "VERIFIED",
            "coverage_summary": "Inpatient, outpatient, emergency, dental and optical",
            "benefit_details": {
                "inpatient": {"covered": True},
                "outpatient": {"covered": True},
                "emergency": {"covered": True},
                "dental": {"covered": True},
                "optical": {"covered": True},
            },
        },
    )
    assert link_res.status_code == 201, link_res.text
    link_id = link_res.json()["id"]

    # 4. Check recomputed status
    kiki_detail = client.get(f"/api/v1/family/members/{kiki_id}", headers=headers).json()
    assert kiki_detail["coverage_status"] == "COVERED"
    assert len(kiki_detail["linked_policies"]) == 1

    # 5. Update consent & authorization
    consent_res = client.post(
        "/api/v1/family/consent",
        headers=headers,
        json={
            "consent_confirmed": True,
            "authorization_scope": ["HEALTH", "CLAIMS", "TRAVEL"],
            "legal_guardian_confirmed": True,
        },
    )
    assert consent_res.status_code == 200

    # 6. Run analysis
    analysis_res = client.post(
        "/api/v1/family/analyze",
        headers=headers,
        json={"include_external_ai": False},
    )
    assert analysis_res.status_code == 200
    assert analysis_res.json()["overview"]["summary"]["total_members"] == 2

    # 7. Unlink policy
    unlink_res = client.delete(
        f"/api/v1/family/members/{kiki_id}/policies/{link_id}",
        headers=headers,
    )
    assert unlink_res.status_code == 200

    # 8. Delete member
    del_res = client.delete(f"/api/v1/family/members/{kiki_id}", headers=headers)
    assert del_res.status_code == 200
