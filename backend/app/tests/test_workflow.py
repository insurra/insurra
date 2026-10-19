"""Integration tests for Joshua-owned workflow routes (SC-08, SC-09, SC-10, SC-11, SC-15, SC-17, SC-19)."""

import hashlib


def test_workflow_overview_and_demo_seed_hydration(client, demo):
    _, headers = demo("raka")
    res = client.get("/api/v1/workflow/claims/overview", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "stats" in data
    assert data["stats"]["open_cases"] >= 1
    assert "recent_activity" in data
    assert "available_policies" in data


def test_workflow_claims_list_and_detail(client, demo):
    _, headers = demo("raka")
    res = client.get("/api/v1/workflow/claims/cases", headers=headers)
    assert res.status_code == 200
    cases = res.json()["cases"]
    assert len(cases) >= 1

    first_claim_id = cases[0]["id"]
    detail_res = client.get(f"/api/v1/workflow/claims/cases/{first_claim_id}", headers=headers)
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["case"]["id"] == first_claim_id
    assert "readiness" in detail
    assert "checklist" in detail
    assert "evidence" in detail
    assert "consistency_checks" in detail


def test_workflow_draft_generation_and_approval_execution_lifecycle(client, demo):
    _, headers = demo("raka")
    # Grant consent as required by security policy
    grant_res = client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )
    assert grant_res.status_code == 200

    # 1. Verify pending action exists from demo seed (ACT-2026-015)
    actions_res = client.get("/api/v1/workflow/actions/queue", headers=headers)
    assert actions_res.status_code == 200
    action_items = actions_res.json()["actions"]
    assert len(action_items) >= 1
    pending_action = action_items[0]
    action_id = pending_action["id"]
    payload_sha256 = pending_action["payload_sha256"]

    # 2. Approve action
    approve_res = client.post(
        f"/api/v1/workflow/actions/{action_id}/approve",
        headers=headers,
        json={"payload_sha256": payload_sha256},
    )
    assert approve_res.status_code == 200
    approval_data = approve_res.json()
    assert approval_data["status"] == "APPROVED"

    # 3. Execute action to sandbox
    exec_res = client.post(
        f"/api/v1/workflow/actions/{action_id}/execute",
        headers=headers,
        json={"environment": "SANDBOX"},
    )
    assert exec_res.status_code == 200
    receipt = exec_res.json()["receipt"]
    assert "receipt_reference" in receipt
    assert receipt["receipt_reference"].startswith("RCT-")

    # 4. Retrieve receipt
    get_rcp = client.get(f"/api/v1/workflow/actions/{action_id}/receipt", headers=headers)
    assert get_rcp.status_code == 200
    assert get_rcp.json()["receipt_reference"] == receipt["receipt_reference"]


def test_workflow_audit_logs(client, demo):
    _, raka_headers = demo("raka")
    _, sinta_headers = demo("sinta")

    res = client.get("/api/v1/workflow/audit/timeline", headers=raka_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["synthetic"] is True
    assert "events" in data
    assert len(data["events"]) >= 1
    assert all(e["synthetic"] is True for e in data["events"])
    assert all("source_table" in e for e in data["events"])

    # Foreign session cannot read Raka's audit event detail
    first_event_id = data["events"][0]["id"]
    own_detail = client.get(f"/api/v1/workflow/audit/events/{first_event_id}", headers=raka_headers)
    assert own_detail.status_code == 200
    foreign_detail = client.get(
        f"/api/v1/workflow/audit/events/{first_event_id}", headers=sinta_headers
    )
    assert foreign_detail.status_code == 404


def test_workflow_claim_creation_idempotency_and_unverified_kb_evidence(client, demo):
    _, headers = demo("raka")
    overview = client.get("/api/v1/workflow/claims/overview", headers=headers).json()
    coverage_ref = overview["available_policies"][0]["ref"]

    # B3.1: Double submit with same Idempotency-Key yields one case
    idem_headers = {**headers, "Idempotency-Key": "claim-idem-raka-001"}
    body = {
        "coverage_ref": coverage_ref,
        "claim_type": "OUTPATIENT",
        "title": "Outpatient clinic visit",
        "origin": "PATHWAY",
        "origin_ref": "pathway-ref-123",
    }
    res1 = client.post("/api/v1/workflow/claims/cases", headers=idem_headers, json=body)
    res2 = client.post("/api/v1/workflow/claims/cases", headers=idem_headers, json=body)
    assert res1.status_code in (200, 201)
    assert res2.status_code in (200, 201)
    case1 = res1.json()["case"]
    case2 = res2.json()["case"]
    assert case1["id"] == case2["id"]

    # B3.2: KB evidence items with UNVERIFIED status are visible as "Insurer requirement unverified"
    checklist = res1.json()["checklist"]
    unverified_items = [
        item
        for item in checklist
        if "Insurer requirement unverified" in (item.get("reason") or "")
        and item["status"] != "NOT_APPLICABLE"
    ]
    assert len(unverified_items) >= 1
    assert all(item["verification"] == "UNVERIFIED_REQUIREMENT" for item in unverified_items)
    assert all(item["status"] == "MISSING" for item in unverified_items)

    # B6.1: Seeded actions have canonical payload hashes matching payload_sha256(payload)
    from app.services.approval import payload_sha256

    queue = client.get("/api/v1/workflow/actions/queue", headers=headers).json()["actions"]
    assert len(queue) >= 4
    for act in queue:
        assert act["payload_sha256"] == payload_sha256(act["payload"])


def test_workflow_emergency_and_triage(client, demo):
    _, headers = demo("raka")
    res = client.get("/api/v1/workflow/emergency/contacts?country_code=CN", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["country_code"] == "CN"
    assert "120" in [c["phone_number"] for c in data["contacts"]]

    # Test triage with chest pain
    triage_res = client.post(
        "/api/v1/workflow/emergency/triage",
        headers=headers,
        json={"text": "severe chest pain and shortness of breath", "country_code": "CN"},
    )
    assert triage_res.status_code == 200
    triage = triage_res.json()
    assert triage["has_red_flag"] is True
    assert triage["recommended_action"] == "INTERRUPT_NON_EMERGENCY_FLOW"


def test_workflow_employer_benefits_and_comparison(client, demo):
    _, headers = demo("raka")
    # SC-15 Employer benefits
    eb_res = client.get("/api/v1/workflow/employer-benefits/overview", headers=headers)
    assert eb_res.status_code == 200
    eb = eb_res.json()
    assert "statutory_schemes" in eb
    assert "coordination_principles" in eb
    assert eb["coordination"] == "UNKNOWN"
    assert eb["coordination_principles"]["coordination"] == "UNKNOWN"

    # SC-17 Product comparison
    comp_res = client.get("/api/v1/workflow/products/compare?country_code=CN", headers=headers)
    assert comp_res.status_code == 200
    comp = comp_res.json()
    assert "products" in comp
    assert len(comp["products"]) >= 2
    assert comp["commission_disclosure"] is None
    assert all(p["verification_status"] == "UNVERIFIED" for p in comp["products"])
    assert all(p["provenance_note"] for p in comp["products"])
    assert all("attributes" in p and "provenance" in p for p in comp["products"])


def test_workflow_proof_verification(client, demo):
    _, headers = demo("raka")
    text = "Official Medical Receipt Content 2026-10-12"
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()

    proof_res = client.post(
        "/api/v1/workflow/proof/verify",
        headers=headers,
        json={
            "original_sha256": sha,
            "candidate_text": text,
        },
    )
    assert proof_res.status_code == 200
    proof = proof_res.json()
    assert proof["verified"] is True
    assert proof["computed_sha256"] == sha

    anchor_res = client.post(
        "/api/v1/workflow/proof/anchor",
        headers=headers,
        json={
            "document_sha256": sha,
            "document_title": "Synthetic Fapiao",
            "mime_type": "text/plain",
        },
    )
    assert anchor_res.status_code == 200
    receipt = anchor_res.json()
    assert receipt["anchoring_type"] == "LOCAL_INTEGRITY_RECEIPT"
    assert receipt["network"] == "LOCAL_ONLY"
    assert receipt["transaction_hash"] is None
    assert receipt["block_number"] is None
    assert receipt["contract_address"] is None
    assert receipt["explorer_url"] is None
    assert len(receipt["receipt_sha256"]) == 64
    assert "on-chain" not in anchor_res.text.lower()
    assert "etherscan" not in anchor_res.text.lower()


def test_workflow_isolation_between_demo_and_foreign_session(client, demo):
    _, owner_headers = demo("raka")
    _, foreign_headers = demo("sinta")

    # Get owner claims
    owner_claims = client.get("/api/v1/workflow/claims/cases", headers=owner_headers).json()[
        "cases"
    ]
    assert len(owner_claims) > 0
    owner_claim_id = owner_claims[0]["id"]

    # Foreign actor cannot access owner claim
    foreign_access = client.get(
        f"/api/v1/workflow/claims/cases/{owner_claim_id}", headers=foreign_headers
    )
    assert foreign_access.status_code == 404
