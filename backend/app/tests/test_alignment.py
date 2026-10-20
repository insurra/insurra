import json
import shutil
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import ROOT
from app.models import ActionRow, ClaimCaseRow, DocumentRow, ExtractedFieldRow, PurposeConsentRow
from app.schemas.actor import Actor
from app.services.approval import payload_sha256
from app.services.kb_loader import CountryKBLoader


def grant(client, headers, purpose, value=True):
    response = client.post(
        "/api/v1/consents", headers=headers, json={"purpose": purpose, "granted": value}
    )
    assert response.status_code == 200
    return response.json()


def test_purposes_are_explicit_independent_and_revocable(client, app, demo):
    _, h = demo()
    states = client.get("/api/v1/consents", headers=h).json()
    assert len(states) == 4 and all(not s["granted"] and s["granted_at"] is None for s in states)
    grant(client, h, "external_ai")

    def ask():
        return client.post("/api/v1/ask", headers=h, json={"question": "Synthetic?"})

    assert ask().status_code == 403
    processing = grant(client, h, "process_documents")
    assert processing["granted_at"] and processing["policy_version"] == "1.5"
    assert ask().status_code == 200
    assert ask().json()["disposition"] == "declined"
    revoked = grant(client, h, "external_ai", False)
    assert revoked["revoked_at"] and revoked["granted_at"]
    assert ask().status_code == 403
    assert client.get("/api/v1/consent", headers=h).json()["processing_consent"] is True
    grant(client, h, "retention")
    grant(client, h, "retention", False)
    assert client.get("/api/v1/profile", headers=h).status_code == 200
    assert client.get("/api/v1/insurance/record", headers=h).status_code == 200
    assert (
        client.post(
            "/api/v1/consents",
            headers=h,
            json={"purpose": "external_ai", "granted": True, "policy_version": "old"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/consents", headers=h, json={"purpose": "external_ai", "granted": "true"}
        ).status_code
        == 422
    )
    with app.state.session_factory() as db:
        assert len(list(db.scalars(select(PurposeConsentRow)))) == 4
    audit = client.get("/api/v1/audit", headers=h).json()
    assert any(e["metadata"].get("purpose") == "external_ai" for e in audit)
    assert "Synthetic?" not in json.dumps(audit)


def test_legacy_grant_never_implies_ai_or_retention(client, demo):
    _, h = demo()
    client.put("/api/v1/consent", headers=h, json={"processing_consent": True})
    states = {s["purpose"]: s["granted"] for s in client.get("/api/v1/consents", headers=h).json()}
    assert states == {
        "process_documents": True,
        "external_ai": False,
        "retention": False,
        "health_profile": False,
    }
    assert (
        client.post("/api/v1/chat/ask", headers=h, json={"question": "Synthetic?"}).status_code
        == 403
    )
    assert client.get("/api/v1/documents", headers=h).status_code == 501
    grant(client, h, "process_documents", False)
    assert client.get("/api/v1/documents", headers=h).status_code == 403


@pytest.fixture
def resources(client, app, demo):
    a, ha = demo()
    b, hb = demo("sinta")
    sa, sb = UUID(a["id"]), UUID(b["id"])
    coverage_id = UUID(
        client.get("/api/v1/insurance/record", headers=ha).json()["policies"][0]["id"]
    )
    with app.state.session_factory() as db:
        doc = DocumentRow(
            session_id=sa, kind="other", country_code="AU", original_filename="synthetic.txt"
        )
        case = ClaimCaseRow(
            session_id=sa, coverage_id=coverage_id, country_code="AU", path="synthetic"
        )
        db.add_all([doc, case])
        db.flush()
        field = ExtractedFieldRow(session_id=sa, document_id=doc.id, field_key="synthetic")
        action = ActionRow(session_id=sa, claim_case_id=case.id, type="claim_submit")
        db.add_all([field, action])
        db.commit()
        ids = {
            "document": str(doc.id),
            "claim": str(case.id),
            "field": str(field.id),
            "action": str(action.id),
            "coverage": str(coverage_id),
        }
    return ids, sa, sb, ha, hb


@pytest.mark.parametrize(
    "kind,method,path,body",
    [
        ("document", "GET", "/documents/{id}", None),
        ("document", "DELETE", "/documents/{id}", {"confirm": "HAPUS"}),
        ("field", "PATCH", "/fields/{id}", {"confirm": True, "value": None}),
        ("claim", "GET", "/claims/{id}", None),
        ("claim", "POST", "/claims/{id}/draft-form", None),
        ("action", "POST", "/actions/{id}/approve", None),
        ("action", "POST", "/actions/{id}/reject", None),
    ],
)
def test_object_stubs_check_identity_consent_ownership(client, resources, kind, method, path, body):
    ids, _, _, ha, hb = resources
    url = "/api/v1" + path.format(id=ids[kind])
    assert client.request(method, url, json=body).status_code == 401
    for headers in [ha, hb]:
        grant(client, headers, "process_documents")
    own = client.request(method, url, headers=ha, json=body)
    foreign = client.request(method, url, headers=hb, json=body)
    missing = client.request(
        method, "/api/v1" + path.format(id=str(uuid4())), headers=hb, json=body
    )
    if kind == "claim" and method == "GET":
        assert own.status_code == 200
        assert own.json()["case"]["id"] == ids["claim"]
        assert own.json()["checklist"] == []
    elif kind == "action" and method == "POST":
        if path.endswith("/approve"):
            assert own.status_code == 422
            assert own.json()["code"] == "EXPLICIT_CONFIRMATION_REQUIRED"
        else:
            assert own.status_code == 200
            assert own.json() == {"status": "REJECTED"}
    else:
        assert own.status_code == 501 and own.json()["code"] == "NOT_IMPLEMENTED"
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json()["code"] == missing.json()["code"] == "RESOURCE_NOT_FOUND"


def test_action_approval_is_owned_persisted_and_bound_to_payload(client, app, resources):
    ids, _, _, owner, foreign = resources
    grant(client, owner, "process_documents")
    grant(client, foreign, "process_documents")
    payload = {
        "claim_case_id": ids["claim"],
        "attachments": [{"document_id": ids["document"], "sha256": "a" * 64}],
    }
    with app.state.session_factory() as db:
        action = db.get(ActionRow, UUID(ids["action"]))
        action.payload = payload
        db.commit()
    url = f"/api/v1/actions/{ids['action']}/approve"
    assert client.post(url, headers=foreign, json={"confirmed": True}).status_code == 404
    assert client.post(url, headers=owner, json={"confirmed": False}).status_code == 422
    assert (
        client.post(
            url, headers=owner, json={"confirmed": True, "expected_payload_sha256": "b" * 64}
        ).json()["code"]
        == "ACTION_PAYLOAD_CHANGED"
    )
    approved = client.post(
        url,
        headers=owner,
        json={"confirmed": True, "expected_payload_sha256": payload_sha256(payload)},
    )
    assert approved.status_code == 200
    assert approved.json() == {"status": "APPROVED"}
    queued = client.get("/api/v1/actions", headers=owner).json()
    assert len(queued) == 1
    assert queued[0]["approved_payload_sha256"] == payload_sha256(payload)
    assert queued[0]["proposed_payload_sha256"] == payload_sha256(payload)
    timeline = client.get(f"/api/v1/claims/{ids['claim']}", headers=owner).json()["timeline"]
    assert [item["event_type"] for item in timeline] == ["ACTION_APPROVED"]
    assert client.get("/api/v1/actions", headers=foreign).json() == []
    with app.state.session_factory() as db:
        action = db.get(ActionRow, UUID(ids["action"]))
        action.payload = {**payload, "attachments": []}
        db.commit()
    execute = client.post(
        f"/api/v1/actions/{ids['action']}/execute",
        headers=owner,
        json={"approved_payload_sha256": payload_sha256(payload)},
    )
    assert execute.status_code == 403
    assert execute.json()["code"] == "APPROVED_PAYLOAD_MISMATCH"


def test_payload_ids_and_approval_hash_fail_closed(client, app, resources):
    ids, _, _, ha, hb = resources
    for headers in [ha, hb]:
        grant(client, headers, "process_documents")
        grant(client, headers, "external_ai")
    assert (
        client.post(
            "/api/v1/claims", headers=hb, json={"path": "synthetic", "coverage_id": ids["coverage"]}
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/ask",
            headers=hb,
            json={"question": "Synthetic?", "coverage_id": ids["coverage"]},
        ).status_code
        == 404
    )
    url = f"/api/v1/actions/{ids['action']}/execute"
    assert (
        client.post(url, headers=ha, json={"approved_payload_sha256": "a" * 64}).status_code == 403
    )
    approved_payload = {
        "claim_case_id": ids["claim"],
        "attachments": [{"document_id": ids["document"], "sha256": "a" * 64}],
    }
    digest = payload_sha256(approved_payload)
    with app.state.session_factory() as db:
        row = db.get(ActionRow, UUID(ids["action"]))
        row.status, row.approved_at, row.approved_payload_sha256 = (
            "APPROVED",
            datetime.now(UTC),
            digest,
        )
        row.payload = approved_payload
        db.commit()
    assert (
        client.post(url, headers=ha, json={"approved_payload_sha256": "b" * 64}).json()["code"]
        == "APPROVED_PAYLOAD_MISMATCH"
    )
    assert client.post(url, headers=ha, json={"approved_payload_sha256": digest}).status_code == 501
    payload = {
        "action_id": ids["action"],
        "claim_case_id": ids["claim"],
        "attachments": [{"document_id": ids["document"], "sha256": "a" * 64}],
        "approved_payload_sha256": digest,
    }
    assert (
        client.post("/api/v1/sandbox/insurer/claims", headers=ha, json=payload).status_code == 501
    )
    assert (
        client.post("/api/v1/sandbox/insurer/claims", headers=hb, json=payload).status_code == 404
    )


def test_database_rejects_cross_owner_relationships(app, resources):
    ids, _, sb, _, _ = resources
    with app.state.session_factory() as db:
        db.add(
            ExtractedFieldRow(session_id=sb, document_id=UUID(ids["document"]), field_key="invalid")
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        db.add(ActionRow(session_id=sb, claim_case_id=UUID(ids["claim"]), type="claim_form"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_privacy_delete_never_claims_success_and_needs_no_processing_grant(client, demo):
    _, h = demo()
    before = client.get("/api/v1/insurance/record", headers=h).json()
    assert (
        client.request("DELETE", "/api/v1/data", headers=h, json={"confirm": "wrong"}).status_code
        == 422
    )
    response = client.request("DELETE", "/api/v1/data", headers=h, json={"confirm": "HAPUS"})
    assert response.status_code == 501 and "deleted" not in response.json()
    assert client.get("/api/v1/insurance/record", headers=h).json() == before
    assert client.get("/api/v1/data", headers=h).status_code == 501


def test_audit_query_and_pagination_stay_scoped(client, demo):
    _, h = demo()
    _, other = demo("sinta")
    grant(client, h, "process_documents")
    grant(client, h, "external_ai")
    response = client.get("/api/v1/audit?type=consent&limit=1&offset=1", headers=h)
    assert len(response.json()) == 1 and response.headers["X-Total-Count"] == "2"
    assert client.get("/api/v1/audit?type=consent", headers=other).json() == []
    assert client.get("/api/v1/audit?limit=101", headers=h).status_code == 422
    assert client.get("/api/v1/audit?offset=-1", headers=h).status_code == 422


def test_actor_interface_does_not_authenticate_an_account(client):
    actor = Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=uuid4())
    with pytest.raises(ValidationError):
        Actor(actor_type="DEMO_SESSION", account_id=actor.account_id)
    assert (
        client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer synthetic", "X-Account-ID": str(actor.account_id)},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": "synthetic@example.test", "password": "synthetic"}
        ).status_code
        == 501
    )


def test_country_resources_metadata_and_bad_config(tmp_path):
    loader = CountryKBLoader(ROOT / "kb")
    for code in ("AU", "ID", "CN"):
        kb = loader.load(code)
        for name in type(kb.resources).model_fields:
            resource = getattr(kb.resources, name)
            assert resource.schema_version == "1.5" and resource.version == kb.manifest.version
        assert kb.resources.extraction_templates.data == []
        if code == "AU":
            assert kb.resources.red_flags.data == []
        else:
            assert kb.resources.emergency.verification_status == "VERIFIED"
            assert all(contact.source_url for contact in kb.resources.emergency.data.contacts)
            assert all(flag.source_url for flag in kb.resources.red_flags.data)
    assert loader.load_injection_patterns().data == []
    shutil.copytree(ROOT / "kb/AU", tmp_path / "AU")
    path = tmp_path / "AU/tasks.json"
    data = json.loads(path.read_text())
    data["version"] = "99.0.0"
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="versions differ"):
        CountryKBLoader(tmp_path).load("AU")
    data["version"] = "0.2.0"
    data["verification_status"] = "VERIFIED"
    path.write_text(json.dumps(data))
    with pytest.raises(ValidationError):
        CountryKBLoader(tmp_path).load("AU")


@pytest.mark.parametrize(
    "method,path,body,needs_consent",
    [
        ("get", "/home/summary", None, False),
        ("get", "/coverage-needs", None, True),
        ("get", "/completeness?task=synthetic", None, True),
        (
            "post",
            "/pathways/compare",
            {"complaint": "synthetic", "service_type": "synthetic"},
            True,
        ),
    ],
)
def test_remaining_scoped_contract_routes(client, demo, method, path, body, needs_consent):
    _, h = demo()
    url = "/api/v1" + path
    assert client.request(method, url, json=body).status_code == 401
    implemented = path in {"/home/summary", "/coverage-needs"}
    assert client.request(method, url, headers=h, json=body).status_code == (
        403 if needs_consent else 200 if implemented else 501
    )
    grant(client, h, "process_documents")
    result = client.request(method, url, headers=h, json=body)
    assert result.status_code == (
        200 if implemented else 422 if path == "/pathways/compare" else 501
    )
    if path == "/pathways/compare":
        assert result.json()["code"] == "SERVICE_NOT_AVAILABLE"


def test_upload_and_evidence_stubs_need_both_purposes(client, resources):
    ids, _, _, h, foreign = resources
    files = {"file": ("synthetic.pdf", b"synthetic test", "application/pdf")}
    urls = ["/api/v1/documents", f"/api/v1/claims/{ids['claim']}/evidence"]
    for url in urls:
        assert client.post(url, files=files).status_code == 401
        assert client.post(url, headers=h, files=files).status_code == 403
    grant(client, h, "process_documents")
    for url in urls:
        assert client.post(url, headers=h, files=files).status_code == 403
    grant(client, h, "external_ai")
    for url in urls:
        assert client.post(url, headers=h, files=files).status_code == 501
    grant(client, h, "external_ai", False)
    for url in urls:
        assert client.post(url, headers=h, files=files).status_code == 403
    grant(client, foreign, "process_documents")
    grant(client, foreign, "external_ai")
    assert client.post(urls[1], headers=foreign, files=files).status_code == 404


def test_registered_routes_and_error_schemas(client):
    schema = client.get("/openapi.json").json()
    expected = {
        "/consents": ["get", "post"],
        "/documents": ["get", "post"],
        "/documents/{document_id}": ["get", "delete"],
        "/fields/{field_id}": ["patch"],
        "/home/summary": ["get"],
        "/ask": ["post"],
        "/pathways/compare": ["post"],
        "/claims": ["get", "post"],
        "/claims/{claim_case_id}": ["get"],
        "/claims/{claim_case_id}/evidence": ["post"],
        "/claims/{claim_case_id}/draft-form": ["post"],
        "/data": ["get", "delete"],
        "/triage": ["post"],
        "/coverage-needs": ["get"],
    }
    for path, methods in expected.items():
        for method in methods:
            operation = schema["paths"]["/api/v1" + path][method]
            assert operation["responses"]["501"]["content"]["application/json"]["schema"] == {
                "$ref": "#/components/schemas/ApiError"
            }
    assert (
        "text/event-stream" in schema["paths"]["/api/v1/ask"]["post"]["responses"]["200"]["content"]
    )
    assert "AskStreamEvent" in schema["components"]["schemas"]
    assert "CountryResources" in schema["components"]["schemas"]

    # Check every reference, including the extra SSE and KB components.
    def references(value):
        if isinstance(value, dict):
            if "$ref" in value and value["$ref"].startswith("#/components/schemas/"):
                assert value["$ref"].rsplit("/", 1)[1] in schema["components"]["schemas"]
            for child in value.values():
                references(child)
        elif isinstance(value, list):
            for child in value:
                references(child)

    references(schema)


def test_server_payload_mutation_invalidates_approval(client, app, resources):
    ids, _, _, h, _ = resources
    grant(client, h, "process_documents")
    payload = {"synthetic": "original"}
    digest = payload_sha256(payload)
    with app.state.session_factory() as db:
        row = db.get(ActionRow, UUID(ids["action"]))
        row.status, row.approved_at, row.approved_payload_sha256 = (
            "APPROVED",
            datetime.now(UTC),
            digest,
        )
        row.payload = {"synthetic": "changed"}
        db.commit()
    result = client.post(
        f"/api/v1/actions/{ids['action']}/execute",
        headers=h,
        json={"approved_payload_sha256": digest},
    )
    assert result.status_code == 403 and result.json()["code"] == "APPROVED_PAYLOAD_MISMATCH"


def test_stream_and_auth_contract_validation():
    from pydantic import TypeAdapter

    from app.schemas.foundation import AccountSummary, AskStreamEvent, RegisterRequest

    with pytest.raises(ValidationError):
        TypeAdapter(AskStreamEvent).validate_python(
            {"event": "error", "data": {"answer_points": []}}
        )
    assert (
        TypeAdapter(AskStreamEvent)
        .validate_python({"event": "complete", "data": {"answer_points": []}})
        .event
        == "complete"
    )
    register = {
        "email": "synthetic@example.test",
        "password": "synthetic123",
        "password_confirmation": "synthetic123",
        "accepted_terms": True,
    }
    RegisterRequest.model_validate(register)
    with pytest.raises(ValidationError):
        RegisterRequest.model_validate({**register, "password_confirmation": "mismatch"})
    with pytest.raises(ValidationError):
        AccountSummary(
            id=uuid4(),
            email_verified=False,
            actor=Actor(actor_type="DEMO_SESSION", session_id=uuid4()),
        )
