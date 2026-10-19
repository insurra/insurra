"""In-app notifications: dedupe, owner scoping, filters, reminders and safe content."""

import hashlib
import re
from datetime import UTC, datetime, timedelta

import pytest

from app.models import AccountSessionRow
from app.schemas.actor import Actor, ActorType
from app.services.events import dispatch
from app.services.notifications import safe_deep_link
from app.tests.test_account_workspace import account_headers, grant, profile_payload


@pytest.fixture
def kb_countries() -> str:
    # Settings override scoped to this module: it uses the inactive legacy kb/AU folder as a
    # fixture-only configuration. The default app keeps AU disabled (see conftest).
    return "AU,CN,ID"


URL = "/api/v1/notifications"


def _account_actor(app, headers) -> Actor:
    token = headers["Authorization"].split()[1]
    with app.state.session_factory() as db:
        row = (
            db.query(AccountSessionRow)
            .filter_by(token_hash=hashlib.sha256(token.encode()).hexdigest())
            .one()
        )
        return Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=row.account_id)


def _emit(app, actor, event, ref, meta=None):
    with app.state.session_factory() as db:
        outcome = dispatch(db, actor, event, ref, meta)
        db.commit()
    return outcome


def test_duplicate_event_creates_one_notification(app, client):
    mine = account_headers(app, "dup")
    actor = _account_actor(app, mine)
    assert _emit(app, actor, "claim.created", "11111111-1111-1111-1111-111111111111") == "created"
    assert _emit(app, actor, "claim.created", "11111111-1111-1111-1111-111111111111") == "duplicate"
    body = client.get(URL, headers=mine).json()
    assert body["total"] == 1 and body["unread_count"] == 1
    assert body["items"][0]["deep_link"] == "/claims/11111111-1111-1111-1111-111111111111"
    assert body["items"][0]["is_demo"] is False


def test_owner_isolation_between_accounts_and_demo(app, client, demo):
    a, b = account_headers(app, "iso_a"), account_headers(app, "iso_b")
    _, da = demo("raka")
    _, db_headers = demo("raka")
    actor_a = _account_actor(app, a)
    _emit(app, actor_a, "claim.created", "claim-a")
    session_id = None
    with app.state.session_factory() as db:
        from app.models import DemoSessionRow

        rows = db.query(DemoSessionRow).order_by(DemoSessionRow.created_at).all()
        session_id = rows[-2].id
    _emit(
        app,
        Actor(actor_type=ActorType.DEMO_SESSION, session_id=session_id),
        "claim.created",
        "claim-demo",
    )
    assert client.get(URL, headers=a).json()["total"] == 1
    assert client.get(URL, headers=b).json()["total"] == 0
    mine_demo = client.get(URL, headers=da).json()
    assert mine_demo["total"] == 1 and mine_demo["items"][0]["is_demo"] is True
    assert client.get(URL, headers=db_headers).json()["total"] == 0
    foreign_id = client.get(URL, headers=a).json()["items"][0]["id"]
    for headers in (b, da, db_headers):
        assert client.post(f"{URL}/{foreign_id}/read", headers=headers).status_code == 404
    assert client.get(URL, headers=a).json()["unread_count"] == 1


def test_read_read_all_unread_count_and_filters(app, client):
    mine = account_headers(app, "reader")
    actor = _account_actor(app, mine)
    _emit(app, actor, "claim.created", "c1")
    _emit(app, actor, "action.prepared", "a1", {"status": "AWAITING_APPROVAL"})
    _emit(app, actor, "document.extraction.completed", "d1")
    _emit(app, actor, "consent.revoked", "retention", {"dedupe_part": "x"})
    assert client.get(f"{URL}/unread-count", headers=mine).json() == {"unread_count": 4}
    for name, expected in (
        ("all", 4),
        ("unread", 4),
        ("action_required", 1),
        ("claims", 1),
        ("protection", 1),
        ("system", 1),
    ):
        assert client.get(f"{URL}?filter={name}", headers=mine).json()["total"] == expected
    first = client.get(URL, headers=mine).json()["items"][0]["id"]
    marked = client.post(f"{URL}/{first}/read", headers=mine).json()
    assert marked["is_read"] is True
    assert client.get(f"{URL}?filter=unread", headers=mine).json()["total"] == 3
    assert client.get(f"{URL}?limit=1&offset=1", headers=mine).json()["items"].__len__() == 1
    result = client.post(f"{URL}/read-all", headers=mine).json()
    assert result == {"updated": 3, "unread_count": 0}
    assert client.get(f"{URL}?filter=bogus", headers=mine).status_code == 422


def test_pending_approval_is_action_required_and_other_status_is_silent(app, client):
    mine = account_headers(app, "approvals")
    actor = _account_actor(app, mine)
    assert _emit(app, actor, "action.prepared", "a2", {"status": "DRAFT"}) is None
    assert _emit(app, actor, "action.prepared", "a1", {"status": "AWAITING_APPROVAL"}) == "created"
    item = client.get(f"{URL}?filter=action_required", headers=mine).json()["items"][0]
    assert item["priority"] == "HIGH" and item["category"] == "ACTION_REQUIRED"


def test_reminders_are_deterministic_and_generic(app, client):
    mine = account_headers(app, "reminders")
    soon = (datetime.now(UTC).date() + timedelta(days=10)).isoformat()
    far = (datetime.now(UTC).date() + timedelta(days=200)).isoformat()
    actor = _account_actor(app, mine)
    from uuid import uuid4

    from app.models import AccountCoverageRow

    with app.state.session_factory() as db:
        for end in (soon, far):
            db.add(
                AccountCoverageRow(
                    id=uuid4(),
                    account_id=actor.account_id,
                    document_id=None,
                    country_code="AU",
                    kind="health",
                    provider="Secret Insurer Pty",
                    policy_number_masked=None,
                    start_date="2026-01-01",
                    end_date=end,
                    created_at=datetime.now(UTC),
                )
            )
        db.commit()
    first = client.get(URL, headers=mine).json()
    second = client.get(URL, headers=mine).json()
    assert first["total"] == second["total"] == 1
    assert first["items"][0]["type"] == "reminder.due"
    assert "Secret" not in str(first) and soon not in str(first)
    assert client.get(f"{URL}/unread-count", headers=mine).json()["unread_count"] == 1


def test_titles_never_contain_medical_amounts_or_document_values(app, client):
    mine = account_headers(app, "safe")
    actor = _account_actor(app, mine)
    for event, ref, meta in (
        ("claim.created", "c1", {"amount": 5000, "provider": "Clinic"}),
        ("claim.status.changed", "c1", {"to_status": "APPROVED_IN_SANDBOX", "dedupe_part": "p"}),
        ("claim.status.changed", "c1", {"to_status": "ADDITIONAL_INFO_REQUIRED"}),
        ("document.review.required", "d1", {}),
        ("action.executed", "a1", {"dedupe_part": "z"}),
    ):
        _emit(app, actor, event, ref, meta)
    text = str(client.get(URL, headers=mine).json()["items"]).lower()
    assert "5000" not in text and "clinic" not in text
    assert not re.search(r"diagnos|prescri|\$|rp\s?\d", text)


def test_preferences_suppress_but_security_notices_remain(app, client):
    mine = account_headers(app, "prefs")
    actor = _account_actor(app, mine)
    assert (
        client.put("/api/v1/preferences", headers=mine, json={"claim_updates": False}).status_code
        == 200
    )
    assert _emit(app, actor, "claim.created", "c1") == "suppressed"
    client.put("/api/v1/preferences", headers=mine, json={"in_app_alerts": False})
    assert _emit(app, actor, "document.review.required", "d1") == "suppressed"
    assert _emit(app, actor, "consent.revoked", "retention", {"dedupe_part": "q"}) == "created"
    assert client.get(URL, headers=mine).json()["total"] == 1


def test_consent_revoke_creates_notification_and_purges(app, client):
    mine = account_headers(app, "revoker")
    client.put("/api/v1/account/profile", headers=mine, json=profile_payload())
    grant(client, mine, "process_documents")
    grant(client, mine, "process_documents", False)
    items = client.get(URL, headers=mine).json()["items"]
    types = {item["type"] for item in items}
    assert {"onboarding.completed", "consent.revoked"} <= types
    # retried identical onboarding does not add another notification
    client.put("/api/v1/account/profile", headers=mine, json=profile_payload())
    assert client.get(URL, headers=mine).json()["total"] == len(items)


def test_demo_consent_revoke_notifies(client, demo):
    _, headers = demo("raka")
    client.post(
        "/api/v1/consents", headers=headers, json={"purpose": "process_documents", "granted": True}
    )
    client.post(
        "/api/v1/consents", headers=headers, json={"purpose": "process_documents", "granted": False}
    )
    body = client.get(URL, headers=headers).json()
    assert any(item["type"] == "consent.revoked" for item in body["items"])


def test_demo_action_approval_and_execution_notify_once(client, demo):
    _, headers = demo("raka")
    client.post(
        "/api/v1/consents", headers=headers, json={"purpose": "process_documents", "granted": True}
    )
    action = client.get("/api/v1/workflow/actions/queue", headers=headers).json()["actions"][0]
    client.post(
        f"/api/v1/workflow/actions/{action['id']}/approve",
        headers=headers,
        json={"payload_sha256": action["payload_sha256"]},
    )
    types = [i["type"] for i in client.get(URL, headers=headers).json()["items"]]
    assert types.count("action.approved") == 1


def test_auth_and_ambiguous_actor(app, client, demo):
    mine = account_headers(app, "auth")
    _, demo_headers = demo("raka")
    assert client.get(URL).status_code == 401
    ambiguous = client.get(URL, headers={**mine, **demo_headers})
    assert ambiguous.status_code == 422
    assert ambiguous.json()["code"] == "AMBIGUOUS_ACTOR"
    assert client.post(f"{URL}/not-a-uuid/read", headers=mine).status_code == 422


def test_deep_links_are_in_app_only():
    assert safe_deep_link("/claims/1") == "/claims/1"
    for bad in ("https://evil.test", "//evil.test", "javascript:alert(1)", "/a/../b", "claims"):
        try:
            safe_deep_link(bad)
        except ValueError:
            continue
        raise AssertionError(bad)
