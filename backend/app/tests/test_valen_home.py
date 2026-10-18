"""SC-05 deterministic counts/context/configuration and persisted recommendations."""

import copy
import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import AccountCoverageRow, AccountFieldRow, RecommendationStateRow
from app.schemas.actor import Actor
from app.schemas.kb import RecommendationRuleConfig
from app.services.command_center import summary
from app.tests.test_account_workspace import account_headers, profile_payload
from app.tests.valen_fixtures import workspace


@pytest.mark.parametrize("country", ["AU", "ID"])
def test_home_is_live_for_accounts_and_preserves_original_countries(app, client, country):
    headers, account, coverage, _ = workspace(app, client, country)
    result = client.get("/api/v1/home/summary", headers=headers)
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["context"]["country_code"] == country and body["coverages"][0]["id"] == str(
        coverage
    )
    assert body["context"]["first_name"] == ("Raka" if country == "AU" else "Sinta")
    assert len(body["recommendations"]) <= 3
    assert all(r["rule_id"].startswith(country + "_") for r in body["recommendations"])
    assert body["emergency"]["phone_number"] is None and not body["triage_available"]
    assert len(body["question_examples"]) in (3, 4)
    assert "policy_number" not in result.text and "member_number" not in result.text
    with app.state.session_factory() as db:
        c = db.get(AccountCoverageRow, coverage)
        c.country_code = "ID" if country == "AU" else "AU"
        db.commit()
    changed = client.get("/api/v1/home/summary", headers=headers).json()
    assert changed["coverages"][0]["country_code"] != changed["context"]["country_code"]


@pytest.mark.parametrize(
    "offset,active,expiring",
    [(0, True, True), (20, True, True), (30, True, True), (31, True, False), (-1, False, False)],
)
@pytest.mark.parametrize("zone", ["Australia/Melbourne", "Asia/Jakarta"])
def test_home_expiry_inclusive_0_30_and_two_timezones(app, client, offset, active, expiring, zone):
    country = "AU" if zone.startswith("Australia") else "ID"
    _, account, coverage, _ = workspace(app, client, country)
    now = datetime(2026, 10, 18, 15, tzinfo=UTC)
    from zoneinfo import ZoneInfo

    today = now.astimezone(ZoneInfo(zone)).date()
    with app.state.session_factory() as db:
        row = db.get(AccountCoverageRow, coverage)
        row.end_date = (today + timedelta(days=offset)).isoformat()
        db.commit()
        result = summary(
            db,
            Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=account),
            app.state.kb_loader,
            now,
        )
        assert result.context.today == today and result.context.timezone == zone
        assert result.active == int(active) and result.expiring_30d == int(expiring)
        assert result.coverages[0].active is active


def test_empty_context_and_future_arrival_no_raw_identifiers(app, client):
    headers = account_headers(app, "empty-home")
    body = profile_payload()
    body["arrival_date"] = "2027-01-01"
    assert client.put("/api/v1/account/profile", headers=headers, json=body).status_code == 200
    result = client.get("/api/v1/home/summary", headers=headers).json()
    assert result["coverages"] == [] and result["active"] == 0
    assert result["context"]["days_since_arrival"] is None
    assert result["recommendations"][0]["rule_id"] == "AU_MISSING_STUDENT_COVER"
    assert result["recommendations"][0]["source"]["source_url"]
    assert not result["recommendations"][0]["dismissible"]


def test_open_ended_membership_requires_explicit_confirmation(app, client):
    _, account, coverage, _ = workspace(app, client, "ID")
    actor = Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=account)
    with app.state.session_factory() as db:
        row = db.get(AccountCoverageRow, coverage)
        row.end_date = None
        db.commit()
        assert summary(db, actor, app.state.kb_loader).active == 0
        db.add(
            AccountFieldRow(
                account_id=account,
                coverage_id=coverage,
                field_key="membership_status",
                value="active",
                status="FOUND",
                confirmed_by_user=True,
                source_type="USER_CONFIRMED",
            )
        )
        db.commit()
        assert summary(db, actor, app.state.kb_loader).active == 1


def test_recommendation_order_maximum_three_seven_day_dismiss_and_visa_handled(
    app, client, monkeypatch
):
    headers, account, coverage, _ = workspace(app, client)
    loader = app.state.kb_loader
    original = loader.load
    country = copy.deepcopy(original("AU"))
    country.resources.recommendation_rules.data = [
        RecommendationRuleConfig(
            rule_id=f"RULE_{n}",
            priority=n,
            conditions={"trigger": "missing_field"},
            text_template=f"Rule {n}",
        )
        for n in [5, 3, 2, 1, 4]
    ]
    monkeypatch.setattr(loader, "load", lambda c: country if c == "AU" else original(c))
    result = client.get("/api/v1/home/summary", headers=headers).json()
    assert [r["rule_id"] for r in result["recommendations"]] == ["RULE_1", "RULE_2", "RULE_3"]
    body = {"rule_id": "RULE_1", "subject": str(coverage), "decision": "dismiss"}
    assert (
        client.post("/api/v1/home/recommendations/decision", headers=headers, json=body).status_code
        == 200
    )
    assert (
        client.get("/api/v1/home/summary", headers=headers).json()["recommendations"][0]["rule_id"]
        == "RULE_2"
    )
    with app.state.session_factory() as db:
        state = db.scalar(
            select(RecommendationStateRow).where(RecommendationStateRow.account_id == account)
        )
        assert (
            timedelta(days=6, hours=23)
            < state.dismissed_until.replace(tzinfo=UTC) - datetime.now(UTC)
            <= timedelta(days=7)
        )
        state.dismissed_until = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    assert (
        client.get("/api/v1/home/summary", headers=headers).json()["recommendations"][0]["rule_id"]
        == "RULE_1"
    )
    country.resources.recommendation_rules.data[3].visa_related = True
    assert (
        client.post("/api/v1/home/recommendations/decision", headers=headers, json=body).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/home/recommendations/decision",
            headers=headers,
            json={**body, "decision": "handled"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/home/recommendations/decision",
            headers=headers,
            json={**body, "decision": "handled", "confirmed": True},
        ).status_code
        == 200
    )
    assert client.get("/api/v1/home/summary", headers=headers).json()["recommendations"][0][
        "handled"
    ]


def test_kb_mutation_and_unverified_regulation_and_emergency_are_conservative(
    app, client, tmp_path
):
    import shutil

    from app.core.config import ROOT
    from app.services.kb_loader import CountryKBLoader

    headers, _, _, _ = workspace(app, client)
    shutil.copytree(ROOT / "kb", tmp_path / "kb")
    app.state.kb_loader = CountryKBLoader(tmp_path / "kb")
    path = tmp_path / "kb/AU/recommendation_rules.json"
    data = json.loads(path.read_text())
    data["data"][2]["text_template"] = "Konfigurasi berubah"
    data["data"][1]["verification_status"] = "UNVERIFIED"
    path.write_text(json.dumps(data))
    body = client.get("/api/v1/home/summary", headers=headers).json()
    assert "Konfigurasi berubah" in [r["title"] for r in body["recommendations"]]
    assert "AU_VISA_GAP" not in [r["rule_id"] for r in body["recommendations"]]
    assert not body["emergency"]["available"]
    for name in ("emergency", "pathways"):
        p = tmp_path / f"kb/AU/{name}.json"
        value = json.loads(p.read_text())
        item = value["data"] if name == "emergency" else value["data"]["emergency"]
        item.update(
            phone_number="TEST-ONLY",
            source_url="https://www.health.gov.au/test",
            checked_at="2026-10-18",
            verification_status="VERIFIED",
        )
        if name == "emergency":
            value.update(
                source_url=item["source_url"],
                checked_at=item["checked_at"],
                verification_status="VERIFIED",
            )
        p.write_text(json.dumps(value))
    assert (
        client.get("/api/v1/home/summary", headers=headers).json()["emergency"]["phone_number"]
        == "TEST-ONLY"
    )


def test_home_demo_compatibility_and_ambiguous_or_forged_credentials(client, demo):
    _, headers = demo()
    assert client.get("/api/v1/home/summary", headers=headers).status_code == 200
    assert client.get("/api/v1/home/summary").status_code == 401
    assert (
        client.get("/api/v1/home/summary", headers={"Authorization": "Bearer forged"}).status_code
        == 401
    )
    assert (
        client.get(
            "/api/v1/home/summary", headers={**headers, "Authorization": "Bearer forged"}
        ).status_code
        == 422
    )
