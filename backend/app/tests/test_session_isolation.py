"""Actor ambiguity, demo session lifecycle (revoke, reset, purge) and isolation."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.models import (
    AuditRow,
    ConsentRow,
    DemoSessionRow,
    InsuranceRecordRow,
    ProfileRow,
    PurposeConsentRow,
)
from app.models.workspace_state import NotificationRow
from app.services.demo_sessions import purge_dead_sessions
from app.workflow.models import WfActionRow, WfClaimCaseRow

BEARER_ROUTES = [
    ("GET", "/api/v1/demo/sessions/me"),  # legacy ActiveSession
    ("GET", "/api/v1/account/consents"),  # ActiveAccount
    ("GET", "/api/v1/workflow/claims/overview"),  # workflow owner
    ("GET", "/api/v1/home/summary"),  # workspace actor
    ("GET", "/api/v1/auth/me"),
    ("POST", "/api/v1/auth/logout"),
]


def account_headers(client, db_session, email="iso@insurra.test"):
    from app.models import AccountRow

    client.post(
        "/api/v1/account/auth/register",
        json={
            "email": email,
            "password": "Password123",
            "password_confirmation": "Password123",
            "accepted_terms": True,
        },
    )
    account = db_session.scalar(select(AccountRow).where(AccountRow.email == email))
    account.email_verified = True
    db_session.commit()
    login = client.post(
        "/api/v1/account/auth/login", json={"email": email, "password": "Password123"}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.parametrize(("method", "path"), BEARER_ROUTES)
def test_every_resolver_rejects_both_actor_headers(client, demo, db_session, method, path):
    _, demo_headers = demo()
    headers = {**demo_headers, **account_headers(client, db_session)}
    response = client.request(method, path, headers=headers)
    assert response.status_code == 422, (path, response.text)
    assert response.json()["code"] == "AMBIGUOUS_ACTOR"


def test_ambiguity_is_rejected_even_with_invalid_tokens(client):
    response = client.get(
        "/api/v1/demo/sessions/me",
        headers={"X-Demo-Session": "nope", "Authorization": "Bearer nope"},
    )
    assert response.status_code == 422 and response.json()["code"] == "AMBIGUOUS_ACTOR"


def test_demo_token_cannot_access_account_routes(client, demo):
    _, headers = demo()
    for path in ("/api/v1/account/consents", "/api/v1/auth/me"):
        response = client.get(path, headers=headers)
        assert response.status_code == 401
        assert response.json()["code"] == "INVALID_ACCOUNT_SESSION"


def test_account_token_cannot_be_used_as_demo_token(client, db_session):
    token = account_headers(client, db_session)["Authorization"].removeprefix("Bearer ")
    response = client.get("/api/v1/demo/sessions/me", headers={"X-Demo-Session": token})
    assert response.status_code == 401


def test_revoked_and_expired_tokens_rejected_on_every_resolver(client, demo, db_session):
    revoked, revoked_headers = demo()
    expired, expired_headers = demo("sinta")
    db_session.get(DemoSessionRow, UUID(revoked["id"])).revoked_at = datetime.now(UTC)
    db_session.get(DemoSessionRow, UUID(expired["id"])).expires_at = datetime.now(UTC) - timedelta(
        seconds=1
    )
    db_session.commit()
    for headers in (revoked_headers, expired_headers):
        for path in (
            "/api/v1/demo/sessions/me",
            "/api/v1/workflow/claims/overview",
            "/api/v1/home/summary",
        ):
            response = client.get(path, headers=headers)
            assert response.status_code == 401, path
            assert response.json()["code"] == "INVALID_SESSION"


def test_delete_current_session_revokes_it(client, demo, db_session):
    data, headers = demo()
    assert client.delete("/api/v1/demo/sessions/me", headers=headers).status_code == 204
    assert client.get("/api/v1/demo/sessions/me", headers=headers).status_code == 401
    assert client.delete("/api/v1/demo/sessions/me", headers=headers).status_code == 401
    db_session.expire_all()
    row = db_session.get(DemoSessionRow, UUID(data["id"]))
    assert row is None or row.revoked_at is not None


def test_reset_returns_baseline_and_old_token_dies(client, demo):
    old, old_headers = demo()
    # Dirty the session: grant document consent, which is part of the baseline as denied.
    granted = client.put("/api/v1/consent", headers=old_headers, json={"processing_consent": True})
    assert granted.status_code == 200
    response = client.post("/api/v1/demo/sessions/me/reset", headers=old_headers)
    assert response.status_code == 201
    fresh = response.json()
    assert fresh["session_token"] != old_headers["X-Demo-Session"]
    assert fresh["persona_id"] == old["persona_id"] and fresh["id"] != old["id"]
    assert client.get("/api/v1/demo/sessions/me", headers=old_headers).status_code == 401
    new_headers = {"X-Demo-Session": fresh["session_token"]}
    me = client.get("/api/v1/demo/sessions/me", headers=new_headers)
    assert me.status_code == 200 and me.json()["id"] == fresh["id"]
    consent = client.get("/api/v1/consent", headers=new_headers).json()
    assert consent["processing_consent"] is False


def test_reset_requires_a_valid_session_and_rejects_ambiguity(client, demo):
    assert client.post("/api/v1/demo/sessions/me/reset").status_code == 401
    _, headers = demo()
    both = {**headers, "Authorization": "Bearer x"}
    assert client.post("/api/v1/demo/sessions/me/reset", headers=both).status_code == 422


def test_two_demo_sessions_are_isolated(client, demo):
    first, first_headers = demo()
    second, second_headers = demo()
    assert first["id"] != second["id"] and first["profile_id"] != second["profile_id"]
    client.put("/api/v1/consent", headers=first_headers, json={"processing_consent": True})
    assert client.get("/api/v1/consent", headers=first_headers).json()["processing_consent"]
    assert not client.get("/api/v1/consent", headers=second_headers).json()["processing_consent"]
    assert (
        client.get("/api/v1/demo/sessions/me", headers=second_headers).json()["id"] == second["id"]
    )


def session_row_counts(db, session_id):
    return {
        "profiles": db.scalar(
            select(func.count()).select_from(ProfileRow).where(ProfileRow.session_id == session_id)
        ),
        "records": db.scalar(
            select(func.count())
            .select_from(InsuranceRecordRow)
            .where(InsuranceRecordRow.session_id == session_id)
        ),
        "consents": db.scalar(
            select(func.count()).select_from(ConsentRow).where(ConsentRow.session_id == session_id)
        ),
        "purposes": db.scalar(
            select(func.count())
            .select_from(PurposeConsentRow)
            .where(PurposeConsentRow.session_id == session_id)
        ),
        "audit": db.scalar(
            select(func.count()).select_from(AuditRow).where(AuditRow.session_id == session_id)
        ),
        "wf_claims": db.scalar(
            select(func.count())
            .select_from(WfClaimCaseRow)
            .where(WfClaimCaseRow.owner_kind == "DEMO", WfClaimCaseRow.owner_id == session_id)
        ),
        "wf_actions": db.scalar(
            select(func.count())
            .select_from(WfActionRow)
            .where(WfActionRow.owner_kind == "DEMO", WfActionRow.owner_id == session_id)
        ),
    }


def test_purge_removes_expired_and_revoked_sessions_with_all_owned_rows(client, demo, db_session):
    dead_expired, _ = demo()
    dead_revoked, _ = demo("sinta")
    live, live_headers = demo()
    # Visiting the workflow materializes owner-scoped wf_* rows without any FK to the session.
    for headers in (live_headers,):
        client.get("/api/v1/workflow/claims/overview", headers=headers)
    db_session.add(
        NotificationRow(
            session_id=UUID(dead_expired["id"]),
            type="t",
            category="c",
            title="x",
            event_source="test",
            dedupe_key="k",
        )
    )
    db_session.get(DemoSessionRow, UUID(dead_expired["id"])).expires_at = datetime.now(
        UTC
    ) - timedelta(hours=1)
    db_session.get(DemoSessionRow, UUID(dead_revoked["id"])).revoked_at = datetime.now(UTC)
    db_session.commit()
    before = {k: session_row_counts(db_session, UUID(dead_expired["id"]))[k] for k in ("profiles",)}
    assert before["profiles"] == 1
    assert session_row_counts(db_session, UUID(dead_revoked["id"]))["audit"] >= 1
    live_before = session_row_counts(db_session, UUID(live["id"]))
    assert live_before["wf_claims"] >= 1, "seed should create workflow claims for the live session"

    assert purge_dead_sessions(db_session) == 2
    for dead in (dead_expired, dead_revoked):
        assert db_session.get(DemoSessionRow, UUID(dead["id"])) is None
        assert set(session_row_counts(db_session, UUID(dead["id"])).values()) == {0}
    assert db_session.scalar(select(func.count()).select_from(NotificationRow)) == 0
    assert session_row_counts(db_session, UUID(live["id"])) == live_before
    assert client.get("/api/v1/demo/sessions/me", headers=live_headers).status_code == 200


def test_session_creation_purges_dead_sessions(client, demo, db_session):
    dead, _ = demo()
    db_session.get(DemoSessionRow, UUID(dead["id"])).revoked_at = datetime.now(UTC)
    db_session.commit()
    demo()
    db_session.expire_all()
    assert db_session.get(DemoSessionRow, UUID(dead["id"])) is None
    assert uuid4() != UUID(dead["id"])


def test_demo_tokens_are_not_logged(client, demo, caplog):
    caplog.set_level("DEBUG")
    data, headers = demo()
    client.get("/api/v1/demo/sessions/me", headers=headers)
    client.delete("/api/v1/demo/sessions/me", headers=headers)
    assert data["session_token"] not in caplog.text
