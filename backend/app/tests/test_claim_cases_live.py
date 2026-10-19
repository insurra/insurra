from uuid import uuid4


def test_claim_case_create_list_detail_and_scope(client, demo):
    _, owner = demo()
    _, foreign = demo("sinta")
    record = client.get("/api/v1/insurance/record", headers=owner).json()
    coverage_id = record["policies"][0]["id"]
    body = {"coverage_id": coverage_id, "path": "manual"}

    assert client.post("/api/v1/claims", headers=owner, json=body).status_code == 403
    assert client.get("/api/v1/claims", headers=owner).json()["pagination"]["total"] == 0
    grant = client.post(
        "/api/v1/consents",
        headers=owner,
        json={"purpose": "process_documents", "granted": True},
    )
    assert grant.status_code == 200
    created = client.post("/api/v1/claims", headers=owner, json=body)
    assert created.status_code == 201
    claim_id = created.json()["claim_case_id"]
    assert client.post("/api/v1/claims", headers=owner, json=body).status_code == 409

    page = client.get("/api/v1/claims?status=DRAFT&limit=1&offset=0", headers=owner).json()
    assert page["pagination"] == {"limit": 1, "offset": 0, "total": 1}
    assert page["items"][0]["case"]["id"] == claim_id
    assert page["items"][0]["case"]["country_code"] == record["country_code"]
    assert page["items"][0]["checklist"] == []
    assert page["items"][0]["consistency_checks"] == []
    assert page["items"][0]["case"]["claim_ref"] is None
    assert page["items"][0]["case"]["sandbox_status"] is None
    assert page["items"][0]["case"]["monitoring_state"] == "NOT_CONFIGURED"
    assert [event["event_type"] for event in page["items"][0]["timeline"]] == ["CASE_CREATED"]
    assert client.get(f"/api/v1/claims/{claim_id}", headers=owner).status_code == 200
    assert client.get("/api/v1/claims", headers=foreign).json()["pagination"]["total"] == 0
    assert client.get(f"/api/v1/claims/{claim_id}", headers=foreign).status_code == 404
    assert client.get(f"/api/v1/claims/{uuid4()}", headers=owner).status_code == 404

    events = client.get("/api/v1/audit?event_type=CLAIM_CREATED", headers=owner).json()
    assert len(events) == 1
    assert events[0]["metadata"]["claim_case_id"] == claim_id
    assert client.get("/api/v1/audit?event_type=CLAIM_CREATED", headers=foreign).json() == []


def test_claim_case_consent_revocation_blocks_new_case_not_existing_read(client, demo):
    _, owner = demo()
    coverage_id = client.get("/api/v1/insurance/record", headers=owner).json()["policies"][0]["id"]
    url = "/api/v1/consents"
    assert (
        client.post(
            url, headers=owner, json={"purpose": "process_documents", "granted": True}
        ).status_code
        == 200
    )
    claim_id = client.post(
        "/api/v1/claims", headers=owner, json={"coverage_id": coverage_id, "path": "manual"}
    ).json()["claim_case_id"]
    assert (
        client.post(
            url, headers=owner, json={"purpose": "process_documents", "granted": False}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/claims", headers=owner, json={"coverage_id": coverage_id, "path": "other"}
        ).status_code
        == 403
    )
    assert client.get(f"/api/v1/claims/{claim_id}", headers=owner).status_code == 200
