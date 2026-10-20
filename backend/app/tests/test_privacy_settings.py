"""Preferences, consent history, export and deletion for accounts and demo sessions."""

from uuid import uuid4

import pytest

from app.models import NotificationRow, UserPreferenceRow
from app.services.account_documents import CandidateField, ExtractionResult, PageText
from app.services.events import dispatch
from app.tests.test_account_workspace import account_headers, grant, profile_payload
from app.tests.test_notifications import _account_actor


@pytest.fixture
def kb_countries() -> str:
    # Settings override scoped to this module: it uses the inactive legacy kb/AU folder as a
    # fixture-only configuration. The default app keeps AU disabled (see conftest).
    return "AU,CN,ID"


PREFS = "/api/v1/preferences"
ACCOUNT = "/api/v1/account"


def test_preferences_defaults_update_validation_and_isolation(app, client, demo):
    mine, other = account_headers(app, "pref_a"), account_headers(app, "pref_b")
    _, demo_headers = demo("raka")
    body = client.get(PREFS, headers=mine).json()
    assert body["in_app_alerts"] is True
    assert body["external_ai_disclosure_acknowledged"] is False
    assert body["display_language"] == "en"
    updated = client.put(
        PREFS,
        headers=mine,
        json={"reminders": False, "external_ai_disclosure_acknowledged": True},
    ).json()
    assert updated["reminders"] is False and updated["external_ai_disclosure_acknowledged"]
    assert updated["claim_updates"] is True
    assert client.get(PREFS, headers=other).json()["reminders"] is True
    assert client.get(PREFS, headers=demo_headers).json()["reminders"] is True
    assert client.put(PREFS, headers=mine, json={"display_language": "id"}).status_code == 422
    assert client.put(PREFS, headers=mine, json={"display_language": "en"}).status_code == 200
    assert client.put(PREFS, headers=mine, json={"unknown": True}).status_code == 422
    assert client.get(PREFS).status_code == 401


def test_connected_sources_are_honestly_empty(app, client):
    mine = account_headers(app, "sources")
    body = client.get(f"{ACCOUNT}/connected-sources", headers=mine).json()
    assert body == {"items": [], "reason": "No connectors are available"}
    assert client.get(f"{ACCOUNT}/connected-sources").status_code == 401


def test_consent_history_lists_safe_fields_only(app, client):
    mine, other = account_headers(app, "hist"), account_headers(app, "hist_other")
    grant(client, mine, "process_documents")
    grant(client, mine, "process_documents", False)
    items = client.get(f"{ACCOUNT}/consents/history", headers=mine).json()["items"]
    assert [(i["purpose"], i["granted"]) for i in items] == [
        ("process_documents", False),
        ("process_documents", True),
    ]
    assert set(items[0]) == {"purpose", "granted", "policy_version", "timestamp"}
    assert client.get(f"{ACCOUNT}/consents/history", headers=other).json()["items"] == []


def _populate(app, client, monkeypatch, headers):
    client.put(f"{ACCOUNT}/profile", headers=headers, json=profile_payload())
    for purpose in ("process_documents", "external_ai", "retention"):
        grant(client, headers, purpose)
    monkeypatch.setattr(
        "app.api.v1.account_documents.extract_text_or_ocr",
        lambda content, mime, country_code: [
            PageText(page_no=1, text="PRIVATE PAGE TEXT", ocr_used=False)
        ],
    )
    monkeypatch.setattr(
        "app.api.v1.account_documents.extract_to_schema",
        lambda pages, country, kind, settings: ExtractionResult(
            fields=[
                CandidateField(field_key="coverage_start_date", value="2026-10-01", source_page=1)
            ]
        ),
    )
    response = client.post(
        f"{ACCOUNT}/documents",
        headers=headers,
        files={"file": ("policy.pdf", b"%PDF-synthetic", "application/pdf")},
        data={"kind": "policy_booklet"},
    )
    assert response.status_code == 201, response.text
    return response.json()["document_id"]


def test_export_is_scoped_metadata_only_and_no_store(app, client, monkeypatch, demo):
    mine, other = account_headers(app, "exporter"), account_headers(app, "exporter_other")
    document_id = _populate(app, client, monkeypatch, mine)
    client.put(PREFS, headers=mine, json={"reminders": False})
    response = client.get(f"{ACCOUNT}/export", headers=mine)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    bundle = response.json()
    assert bundle["documents"][0]["id"] == document_id
    assert "PRIVATE PAGE TEXT" not in response.text
    assert "content" not in bundle["documents"][0]
    assert bundle["preferences"]["reminders"] is False
    assert bundle["profile"]["country_code"] == "AU"
    assert {n["type"] for n in bundle["notifications"]} >= {"onboarding.completed"}
    foreign = client.get(f"{ACCOUNT}/export", headers=other).json()
    assert foreign["documents"] == [] and foreign["notifications"] == []
    audit = client.get(f"{ACCOUNT}/audit?event_type=DATA_EXPORTED", headers=mine).json()
    assert len(audit) == 1
    assert client.get(f"{ACCOUNT}/export").status_code == 401
    _, demo_headers = demo("raka")
    assert client.get(f"{ACCOUNT}/export", headers=demo_headers).status_code == 401


def test_delete_cleans_everything_and_is_idempotent(app, client, monkeypatch):
    mine, other = account_headers(app, "deleter"), account_headers(app, "deleter_other")
    document_id = _populate(app, client, monkeypatch, mine)
    client.put(f"{ACCOUNT}/profile", headers=other, json=profile_payload())
    client.put(PREFS, headers=mine, json={"reminders": False})
    actor = _account_actor(app, mine)
    with app.state.session_factory() as db:
        dispatch(db, actor, "claim.created", str(uuid4()))
        db.commit()
    assert (
        client.request(
            "DELETE", f"{ACCOUNT}/data", headers=mine, json={"confirm": "nope"}
        ).status_code
        == 422
    )
    for token in ("DELETE", "HAPUS"):
        response = client.request(
            "DELETE", f"{ACCOUNT}/data", headers=mine, json={"confirm": token}
        )
        assert response.status_code == 200 and response.json() == {"deleted": True}
    assert client.get(f"{ACCOUNT}/documents/{document_id}", headers=mine).status_code == 404
    inventory = client.get(f"{ACCOUNT}/inventory", headers=mine).json()
    assert inventory["document_count"] == 0 and inventory["action_count"] == 0
    assert client.get("/api/v1/notifications", headers=mine).json()["total"] == 0
    assert client.get(PREFS, headers=mine).json()["reminders"] is True
    with app.state.session_factory() as db:
        assert (
            db.query(UserPreferenceRow)
            .filter(UserPreferenceRow.account_id == actor.account_id)
            .count()
            == 0
        )
        assert (
            db.query(NotificationRow).filter(NotificationRow.account_id == actor.account_id).count()
            == 0
        )
    # another account is untouched
    assert client.get("/api/v1/notifications", headers=other).json()["total"] == 1


def test_delete_removes_owner_workflow_rows_for_account(app, client):
    mine = account_headers(app, "wf_delete")
    actor = _account_actor(app, mine)
    from app.workflow.models import WfActionRow, WfClaimCaseRow
    from app.workflow.owner import ACCOUNT as ACCOUNT_KIND

    with app.state.session_factory() as db:
        before = db.query(WfClaimCaseRow).filter_by(owner_id=actor.account_id).count()
        assert before == 0
    response = client.request("DELETE", f"{ACCOUNT}/data", headers=mine, json={"confirm": "DELETE"})
    assert response.status_code == 200
    with app.state.session_factory() as db:
        assert (
            db.query(WfActionRow)
            .filter_by(owner_kind=ACCOUNT_KIND, owner_id=actor.account_id)
            .count()
            == 0
        )


def test_demo_preferences_are_session_scoped(client, demo):
    _, first = demo("raka")
    _, second = demo("raka")
    client.put(PREFS, headers=first, json={"claim_updates": False})
    assert client.get(PREFS, headers=first).json()["claim_updates"] is False
    assert client.get(PREFS, headers=second).json()["claim_updates"] is True
