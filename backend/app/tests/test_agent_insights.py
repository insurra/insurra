"""Tests for Protection Insights engine, API, and event consumer (B2.1, B4.3)."""

from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from app.agent.worker import process_due
from app.models import AccountCoverageRow, ProtectionInsightRow
from app.schemas.actor import Actor, ActorType
from app.services.events import dispatch
from app.tests.test_account_workspace import account_headers, profile_payload


def _account_actor(app, headers) -> Actor:
    import hashlib

    from app.models import AccountSessionRow

    token = headers["Authorization"].split()[1]
    with app.state.session_factory() as db:
        row = (
            db.query(AccountSessionRow)
            .filter_by(token_hash=hashlib.sha256(token.encode()).hexdigest())
            .one()
        )
        return Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=row.account_id)


def test_raka_continuity_insight_is_needs_verification_and_idempotent(app, client, demo):
    _, headers = demo("raka")
    r1 = client.get("/api/v1/insights", headers=headers)
    assert r1.status_code == 200
    body1 = r1.json()
    assert body1["synthetic"] is True

    continuity = [item for item in body1["items"] if item["kind"] == "COVERAGE_CONTINUITY_INTERVAL"]
    assert len(continuity) == 1
    ins = continuity[0]
    assert ins["severity"] == "NEEDS_VERIFICATION"
    assert ins["status"] == "OPEN"
    days_fact = next(f for f in ins["facts"] if f["key"] == "uncovered_days")
    assert days_fact["value"] == "76"
    assert days_fact["unit"] == "days"

    # Recompute is idempotent: second GET returns the exact same insight ID and no duplicate rows
    r2 = client.get("/api/v1/insights", headers=headers)
    assert r2.status_code == 200
    continuity2 = [
        item for item in r2.json()["items"] if item["kind"] == "COVERAGE_CONTINUITY_INTERVAL"
    ]
    assert len(continuity2) == 1
    assert continuity2[0]["id"] == ins["id"]


def test_high_severity_insight_rejects_dismiss_and_enforces_owner_isolation(app, client, demo):
    headers_a = account_headers(app, "ins_owner_a")
    headers_b = account_headers(app, "ins_owner_b")
    actor_a = _account_actor(app, headers_a)

    # Create a policy expiring in 3 days (HIGH severity)
    soon_end = (date.today() + timedelta(days=3)).isoformat()
    with app.state.session_factory() as db:
        db.add(
            AccountCoverageRow(
                id=uuid4(),
                account_id=actor_a.account_id,
                document_id=None,
                country_code="CN",
                kind="INTERNATIONAL_STUDENT",
                provider="Test Plan",
                policy_number_masked="****9999",
                start_date="2026-01-01",
                end_date=soon_end,
            )
        )
        db.commit()

    items = client.get("/api/v1/insights", headers=headers_a).json()["items"]
    expiring = next(i for i in items if i["kind"] == "POLICY_EXPIRY_SOON")
    assert expiring["severity"] == "HIGH"
    missing_ev = next(i for i in items if i["kind"] == "MISSING_EVIDENCE")
    assert missing_ev["severity"] == "NORMAL"

    # HIGH insight cannot be dismissed (409 INSIGHT_REQUIRES_RESOLUTION)
    res_high = client.post(
        f"/api/v1/insights/{expiring['id']}/decision",
        headers=headers_a,
        json={"decision": "DISMISS"},
    )
    assert res_high.status_code == 409
    assert res_high.json()["code"] == "INSIGHT_REQUIRES_RESOLUTION"

    # Foreign owner gets 404
    res_foreign = client.post(
        f"/api/v1/insights/{missing_ev['id']}/decision",
        headers=headers_b,
        json={"decision": "DISMISS"},
    )
    assert res_foreign.status_code == 404

    # NORMAL insight can be dismissed by its owner and stays dismissed on recompute
    res_ok = client.post(
        f"/api/v1/insights/{missing_ev['id']}/decision",
        headers=headers_a,
        json={"decision": "DISMISS"},
    )
    assert res_ok.status_code == 200
    assert res_ok.json()["status"] == "RESOLVED"

    after_items = client.get("/api/v1/insights", headers=headers_a).json()["items"]
    assert all(i["id"] != missing_ev["id"] for i in after_items)


def test_profile_change_event_supersedes_and_updates_insight_once(app, client):
    headers = account_headers(app, "ins_recompute")
    actor = _account_actor(app, headers)

    payload = profile_payload()
    payload["country_code"] = "CN"
    payload["arrival_date"] = "2026-09-01"
    payload["visa_expiry_date"] = "2027-06-30"
    assert client.put("/api/v1/account/profile", headers=headers, json=payload).status_code == 200

    with app.state.session_factory() as db:
        db.add(
            AccountCoverageRow(
                id=uuid4(),
                account_id=actor.account_id,
                document_id=None,
                country_code="CN",
                kind="INTERNATIONAL_STUDENT",
                provider="Shenzhen Plan",
                policy_number_masked="****1111",
                start_date="2026-09-01",
                end_date="2027-04-15",
            )
        )
        db.commit()

    first_items = client.get("/api/v1/insights", headers=headers).json()["items"]
    first_cont = next(i for i in first_items if i["kind"] == "COVERAGE_CONTINUITY_INTERVAL")
    assert any(f["value"] == "76" for f in first_cont["facts"])

    # Change visa_expiry_date to 2027-05-15 (30 uncovered days) and emit profile.context.changed
    payload["visa_expiry_date"] = "2027-05-15"
    assert client.put("/api/v1/account/profile", headers=headers, json=payload).status_code == 200
    with app.state.session_factory() as db:
        dispatch(
            db,
            actor,
            "profile.context.changed",
            str(actor.account_id),
            {"country_code": "CN"},
            dedupe_key="profile.context.changed:2027-05-15",
        )
        db.commit()

    process_due(app.state.session_factory, now=datetime.now(UTC) + timedelta(seconds=5))

    second_items = client.get("/api/v1/insights", headers=headers).json()["items"]
    second_cont = [i for i in second_items if i["kind"] == "COVERAGE_CONTINUITY_INTERVAL"]
    assert len(second_cont) == 1
    assert second_cont[0]["id"] != first_cont["id"]
    assert any(f["value"] == "30" for f in second_cont[0]["facts"])

    with app.state.session_factory() as db:
        from uuid import UUID

        old_row = db.scalar(
            select(ProtectionInsightRow).where(ProtectionInsightRow.id == UUID(first_cont["id"]))
        )
        assert old_row is not None
        assert old_row.status == "SUPERSEDED"
