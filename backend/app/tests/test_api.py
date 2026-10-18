import hashlib
import io
import json
import ssl
from datetime import UTC, datetime, timedelta
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request as UrlRequest
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.api.auth import _provider_json
from app.core.errors import AppError
from app.models import AccountRow, AccountSessionRow, AuditRow, DemoSessionRow


def test_health_and_docs(client):
    assert client.get("/health").json() == {"status": "ok", "version": "0.1.0"}
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    assert schema["info"]["version"] == "0.1.0"
    for path in [
        "/api/v1/chat/ask",
        "/api/v1/documents/upload",
        "/api/v1/actions/{action_id}/approve",
    ]:
        assert schema["paths"][path]["post"]["responses"]["501"]["content"]["application/json"][
            "schema"
        ] == {"$ref": "#/components/schemas/ApiError"}
    # FastAPI's automatic validation error must not override the shared error contract.
    assert schema["paths"]["/api/v1/profile"]["put"]["responses"]["422"]["content"][
        "application/json"
    ]["schema"]["$ref"].endswith("/ApiError")


def test_country_discovery_and_personas(client):
    countries = client.get("/api/v1/countries").json()
    assert {c["country_code"] for c in countries} == {"AU", "CN", "ID"}
    assert all(c["verification_status"] == "UNVERIFIED" for c in countries)
    assert {p["persona_id"] for p in client.get("/api/v1/demo/personas").json()} == {
        "raka",
        "sinta",
    }


def test_google_login_uses_state_and_pkce(client):
    response = client.get("/auth/google", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "code_challenge_method=S256" in response.headers["location"]
    assert "insurra_oauth_state=" in response.headers["set-cookie"]


def test_google_provider_uses_explicit_verified_ssl_context(monkeypatch):
    class ProviderResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self):
            return b'{"access_token":"synthetic"}'

    def fake_urlopen(_request, *, data, timeout, context):
        assert data is None
        assert timeout == 15
        assert isinstance(context, ssl.SSLContext)
        assert context.verify_mode == ssl.CERT_REQUIRED
        assert context.check_hostname is True
        return ProviderResponse()

    monkeypatch.setattr("app.api.auth.urlopen", fake_urlopen)
    assert _provider_json(UrlRequest("https://example.com")) == {"access_token": "synthetic"}


def test_google_provider_surfaces_invalid_grant(monkeypatch):
    def reject_request(*_args, **_kwargs):
        raise HTTPError(
            "https://oauth2.googleapis.com/token",
            400,
            "Bad Request",
            {},
            io.BytesIO(b'{"error":"invalid_grant","error_description":"private detail"}'),
        )

    monkeypatch.setattr("app.api.auth.urlopen", reject_request)
    with pytest.raises(AppError) as caught:
        _provider_json(UrlRequest("https://oauth2.googleapis.com/token"))
    assert caught.value.status_code == 400
    assert caught.value.code == "OAUTH_CODE_INVALID"
    assert "private detail" not in caught.value.message


def test_google_callback_creates_account_session(client, app, monkeypatch):
    login = client.get("/auth/google", follow_redirects=False)
    state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]
    responses = iter(
        [
            {"access_token": "synthetic-provider-token"},
            {
                "sub": "google-user-1",
                "email": "google@example.com",
                "email_verified": True,
                "name": "Google Person",
                "picture": "https://example.com/avatar.png",
            },
        ]
    )
    monkeypatch.setattr("app.api.auth._provider_json", lambda *_args, **_kwargs: next(responses))
    callback = client.get(
        f"/auth/google/callback?code=synthetic-code&state={state}", follow_redirects=False
    )
    assert callback.status_code == 303
    assert callback.headers["location"].startswith(
        "http://127.0.0.1:3000/auth/callback#access_token="
    )
    with app.state.session_factory() as db:
        account = db.scalar(select(AccountRow).where(AccountRow.email == "google@example.com"))
        assert account is not None
        assert db.scalar(
            select(AccountSessionRow).where(AccountSessionRow.account_id == account.id)
        )


def test_account_session_me_and_logout(client, app):
    token = "synthetic-account-token"
    now = datetime.now(UTC)
    account_id = uuid4()
    with app.state.session_factory() as db:
        db.add(
            AccountRow(
                id=account_id,
                email="person@example.com",
                display_name="Synthetic Person",
                avatar_url=None,
                email_verified=True,
                created_at=now,
                updated_at=now,
            )
        )
        db.add(
            AccountSessionRow(
                id=uuid4(),
                account_id=account_id,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                created_at=now,
                expires_at=now + timedelta(days=7),
                revoked_at=None,
            )
        )
        db.commit()
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "person@example.com"
    assert me.json()["actor"] == {
        "actor_type": "AUTHENTICATED_ACCOUNT",
        "session_id": None,
        "account_id": str(account_id),
    }
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


@pytest.mark.parametrize("token", [None, "invalid-token", "", "x" * 129])
def test_invalid_session_fails_closed(client, token):
    response = client.get("/api/v1/profile", headers={"X-Demo-Session": token} if token else {})
    assert response.status_code in {401, 422}
    assert set(response.json()) == {"code", "message", "details", "request_id"}
    assert response.headers["x-request-id"] == response.json()["request_id"]
    assert token is None or token not in response.text if token else True


def test_expired_session(client, app, demo):
    data, headers = demo()
    with app.state.session_factory() as db:
        row = db.get(DemoSessionRow, UUID(data["id"]))
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    assert client.get("/api/v1/demo/sessions/me", headers=headers).status_code == 401


def test_session_creation_and_token_storage(client, app, demo):
    data, headers = demo()
    assert len(data["session_token"]) >= 40
    me = client.get("/api/v1/demo/sessions/me", headers=headers).json()
    assert me["id"] == data["id"] and "session_token" not in me
    with app.state.session_factory() as db:
        row = db.get(DemoSessionRow, UUID(data["id"]))
        assert row.token_hash == hashlib.sha256(data["session_token"].encode()).hexdigest()
        assert data["session_token"] not in str(row.__dict__)


def test_unknown_persona(client):
    r = client.post("/api/v1/demo/sessions", json={"persona_id": "missing"})
    assert r.status_code == 404
    assert r.json()["code"] == "PERSONA_NOT_FOUND"


def test_consent_defaults_grants_revokes_and_audits(client, app, demo):
    data, h = demo()
    assert client.get("/api/v1/consent", headers=h).json()["processing_consent"] is False
    assert (
        client.post(
            "/api/v1/chat/ask", headers=h, json={"question": "Apa manfaat polis?"}
        ).status_code
        == 403
    )
    grant = client.put("/api/v1/consent", headers=h, json={"processing_consent": True})
    assert grant.status_code == 200 and grant.json()["processing_consent"] is True
    assert (
        client.post("/api/v1/chat/ask", headers=h, json={"question": "Manfaat?"}).status_code == 403
    )
    client.post("/api/v1/consents", headers=h, json={"purpose": "external_ai", "granted": True})
    assert (
        client.post(
            "/api/v1/chat/ask", headers=h, json={"question": "Apa manfaat polis?"}
        ).status_code
        == 501
    )
    revoke = client.put("/api/v1/consent", headers=h, json={"processing_consent": False})
    assert revoke.json()["processing_consent"] is False
    assert (
        client.post("/api/v1/chat/ask", headers=h, json={"question": "Apa manfaat polis?"}).json()[
            "code"
        ]
        == "CONSENT_REQUIRED"
    )
    events = client.get("/api/v1/audit", headers=h).json()
    assert {e["event_type"] for e in events} == {
        "SESSION_CREATED",
        "CONSENT_GRANTED",
        "CONSENT_REVOKED",
    }
    assert all(e["session_id"] == data["id"] for e in events)
    filtered = client.get("/api/v1/audit?event_type=CONSENT_REVOKED", headers=h).json()
    assert len(filtered) == 1
    with app.state.session_factory() as db:
        audit_payload = json.dumps([r.event_metadata for r in db.scalars(select(AuditRow))])
    assert data["session_token"] not in audit_payload
    assert "question" not in audit_payload
    assert (
        client.put("/api/v1/consent", headers=h, json={"processing_consent": "true"}).status_code
        == 422
    )


def test_isolation_including_same_persona_and_document_identifiers(client, demo):
    a, ha = demo()
    b, hb = demo("sinta")
    c, hc = demo()
    pa = client.get("/api/v1/profile", headers=ha).json()
    pb = client.get("/api/v1/profile", headers=hb).json()
    pc = client.get("/api/v1/profile", headers=hc).json()
    assert len({pa["id"], pb["id"], pc["id"]}) == 3
    assert pa["display_name"] == pc["display_name"] == "Raka"
    assert pb["display_name"] == "Sinta"
    client.put("/api/v1/consent", headers=ha, json={"processing_consent": True})
    assert client.get("/api/v1/consent", headers=hb).json()["processing_consent"] is False
    ra = client.get("/api/v1/insurance/record", headers=ha).json()
    rb = client.get("/api/v1/insurance/record", headers=hb).json()
    rc = client.get("/api/v1/insurance/record", headers=hc).json()
    assert ra["profile_id"] == pa["id"] and rb["profile_id"] == pb["id"]
    assert ra["documents"][0]["id"] != rc["documents"][0]["id"]
    assert ra["policies"][0]["source_document_ids"] == [ra["documents"][0]["id"]]
    update = {k: v for k, v in pa.items() if k not in {"id", "created_at", "updated_at"}}
    update["display_name"] = "Raka diperbarui"
    assert client.put("/api/v1/profile", headers=ha, json=update).status_code == 200
    assert client.get("/api/v1/profile", headers=hc).json()["display_name"] == "Raka"
    assert all(e["session_id"] == b["id"] for e in client.get("/api/v1/audit", headers=hb).json())
    # Client-supplied ownership identifiers cannot override current-session scoping.
    update["id"] = pb["id"]
    assert client.put("/api/v1/profile", headers=ha, json=update).status_code == 422


@pytest.mark.parametrize(
    "persona,types,gap,status",
    [
        ("raka", {"OSHC"}, 76, "NEEDS_VERIFICATION"),
        ("sinta", {"BPJS", "EMPLOYER"}, None, "NOT_APPLICABLE"),
    ],
)
def test_records_and_assessments(client, demo, persona, types, gap, status):
    _, h = demo(persona)
    record = client.get("/api/v1/insurance/record", headers=h).json()
    assert {p["policy_type"] for p in record["policies"]} == types
    assert all(
        item["coverage_status"] == "UNKNOWN" and item["evidence"] is None
        for p in record["policies"]
        for item in p["coverage_items"]
    )
    result = client.get("/api/v1/assessments/visa-gap", headers=h).json()
    assert result["gap_days"] == gap and result["assessment_status"] == status
    if gap:
        assert result["gap_periods"] == [{"start_date": "2027-04-16", "end_date": "2027-06-30"}]
    assert client.get("/api/v1/audit?event_type=VISA_GAP_ASSESSED", headers=h).json()


def test_profile_validation_and_country_guard(client, demo):
    _, h = demo()
    p = client.get("/api/v1/profile", headers=h).json()
    body = {k: v for k, v in p.items() if k not in {"id", "created_at", "updated_at"}}
    assert (
        client.put("/api/v1/profile", headers=h, json={**body, "country_code": "ZZ"}).json()["code"]
        == "UNSUPPORTED_COUNTRY"
    )
    assert (
        client.put(
            "/api/v1/profile", headers=h, json={**body, "visa_expiry_date": "2020-01-01"}
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/v1/profile", headers=h, json={**body, "visa_expiry_date": None}
        ).status_code
        == 200
    )
    assert (
        client.get("/api/v1/assessments/visa-gap", headers=h).json()["assessment_status"]
        == "NEEDS_VERIFICATION"
    )


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("get", "/documents", None),
        ("get", "/assessments/completeness", None),
        ("get", "/assessments/coverage-needs", None),
        ("post", "/chat/ask", {"question": "Manfaat?"}),
        ("post", "/care/compare", {"symptoms": "Keluhan sintetis"}),
        ("post", "/claims/draft", {"selected_pathway_code": "GP"}),
        ("get", "/actions", None),
        ("post", "/actions/00000000-0000-0000-0000-000000000001/approve", None),
        ("post", "/actions/00000000-0000-0000-0000-000000000001/reject", None),
    ],
)
def test_skeletons_fail_honestly_and_require_consent(client, app, demo, method, path, body):
    data, h = demo()
    if path.startswith("/actions/"):
        from app.models import ActionRow

        with app.state.session_factory() as db:
            db.add(
                ActionRow(
                    id=UUID(path.split("/")[2]), session_id=UUID(data["id"]), type="claim_form"
                )
            )
            db.commit()
    kwargs = {"headers": h}
    if body is not None:
        kwargs["json"] = body
    assert client.request(method, "/api/v1" + path, **kwargs).status_code == 403
    client.put("/api/v1/consent", headers=h, json={"processing_consent": True})
    client.post("/api/v1/consents", headers=h, json={"purpose": "external_ai", "granted": True})
    response = client.request(method, "/api/v1" + path, **kwargs)
    assert response.status_code == 501
    assert response.json()["code"] == "NOT_IMPLEMENTED"


def test_upload_is_explicitly_not_implemented(client, demo):
    _, h = demo()
    files = {"file": ("synthetic.txt", b"SYNTHETIC", "text/plain")}
    assert client.post("/api/v1/documents/upload", headers=h, files=files).status_code == 403
    client.put("/api/v1/consent", headers=h, json={"processing_consent": True})
    client.post("/api/v1/consents", headers=h, json={"purpose": "external_ai", "granted": True})
    assert client.post("/api/v1/documents/upload", headers=h, files=files).status_code == 501


def test_cors_is_scoped(client):
    for origin, allowed in [("http://localhost:3000", True), ("https://untrusted.example", False)]:
        response = client.options(
            "/api/v1/profile",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "X-Demo-Session",
            },
        )
        assert (response.headers.get("access-control-allow-origin") == origin) == allowed


def test_session_persists_across_app_restart(client, app, demo):
    from fastapi.testclient import TestClient

    from app.main import create_app

    data, headers = demo()
    client.put("/api/v1/consent", headers=headers, json={"processing_consent": True})
    with TestClient(create_app(app.state.settings)) as restarted:
        assert restarted.get("/api/v1/demo/sessions/me", headers=headers).json()["id"] == data["id"]
        assert (
            restarted.get("/api/v1/consent", headers=headers).json()["processing_consent"] is True
        )
        assert (
            restarted.get("/api/v1/insurance/record", headers=headers).json()["profile_id"]
            == data["profile_id"]
        )


def test_openapi_snapshot_matches_python_contract(client):
    from app.core.config import ROOT

    assert client.get("/openapi.json").json() == json.loads(
        (ROOT / "backend/openapi.json").read_text()
    )
