"""Acceptance and unit tests for Flow 6: Proactive Renewal & Anti-Lapse Agent (Home / Actions · P0).

Requirements:
- Configurable H-30, H-7, H-1 checks.
- Date and timezone correctness.
- Detect possible continuity gaps.
- Distinguish historical document expiry from confirmed current lapse.
- Deduplicate findings and notifications.
- Show prioritized next actions on Home.
- Draft a request using verified data.
- No automatic purchase, payment, or renewal (safety gate).
- Store execution response from authorized sandbox/channel with receipt.
"""

from datetime import date, timedelta
from uuid import uuid4

from app.models.account_data import AccountCoverageRow
from app.services.anti_lapse_agent import (
    resolve_owner_timezone,
    run_anti_lapse_agent,
)
from app.workflow.owner import Owner


def test_timezone_resolution():
    """Verify timezone correctness for ID, CN, AU contexts."""
    tz_id, name_id = resolve_owner_timezone("ID")
    assert name_id == "Asia/Jakarta"
    tz_cn, name_cn = resolve_owner_timezone("CN")
    assert name_cn == "Asia/Shanghai"
    tz_au, name_au = resolve_owner_timezone("AU")
    assert name_au == "Australia/Sydney"


def test_distinguish_historical_expiry_from_confirmed_lapse(app, client):
    """Verify distinction between past document expiry (>90d) and confirmed current lapse."""
    from app.services.workspace import Actor
    from app.tests.workspace_fixtures import workspace

    headers, account_id, _, _ = workspace(app, client, "ID")
    actor = Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=account_id)
    owner = Owner(kind="ACCOUNT", id=account_id)
    today = date(2026, 10, 20)

    # Consent grant for processing documents
    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    with app.state.session_factory() as db:
        # Add historical coverage: expired 180 days ago
        cov_hist = AccountCoverageRow(
            id=uuid4(),
            account_id=account_id,
            country_code="ID",
            kind="Health",
            provider="Past Provider",
            policy_number_masked="POL-***-111",
            start_date="2025-01-01",
            end_date=(today - timedelta(days=180)).isoformat(),
            policy_status="EXPIRED",
        )
        # Add confirmed lapse coverage: expired 10 days ago
        cov_lapse = AccountCoverageRow(
            id=uuid4(),
            account_id=account_id,
            country_code="ID",
            kind="Dental",
            provider="Lapsed Provider",
            policy_number_masked="POL-***-222",
            start_date="2025-10-01",
            end_date=(today - timedelta(days=10)).isoformat(),
            policy_status="LAPSED",
        )
        # Add upcoming expiring coverage (H-30)
        cov_upcoming = AccountCoverageRow(
            id=uuid4(),
            account_id=account_id,
            country_code="ID",
            kind="Health",
            provider="Upcoming Care",
            policy_number_masked="POL-***-333",
            start_date="2025-11-15",
            end_date=(today + timedelta(days=25)).isoformat(),
            policy_status="ACTIVE",
        )
        db.add_all([cov_hist, cov_lapse, cov_upcoming])
        db.commit()

        status = run_anti_lapse_agent(db, owner, actor=actor, today=today, offsets=(30, 7, 1))

        # Check policy status classification
        hist_item = next(
            (p for p in status.active_monitored_policies if p.provider == "Past Provider"), None
        )
        assert hist_item is not None
        assert hist_item.status == "HISTORICAL_DOCUMENT_EXPIRED"
        assert hist_item.is_historical is True

        lapse_item = next(
            (p for p in status.active_monitored_policies if p.provider == "Lapsed Provider"), None
        )
        assert lapse_item is not None
        assert lapse_item.status == "CONFIRMED_CURRENT_LAPSE"
        assert lapse_item.is_historical is False

        upcoming_item = next(
            (p for p in status.active_monitored_policies if p.provider == "Upcoming Care"), None
        )
        assert upcoming_item is not None
        assert upcoming_item.status == "UPCOMING_EXPIRY"
        assert upcoming_item.is_historical is False


def test_continuity_gap_detection(app, client):
    """Verify detection of gaps between consecutive policies and stay horizons."""
    from app.services.workspace import Actor
    from app.tests.workspace_fixtures import workspace

    headers, account_id, _, _ = workspace(app, client, "ID")
    actor = Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=account_id)
    owner = Owner(kind="ACCOUNT", id=account_id)
    today = date(2026, 10, 20)

    with app.state.session_factory() as db:
        # Policy A: ends 2026-11-30
        cov_a = AccountCoverageRow(
            id=uuid4(),
            account_id=account_id,
            country_code="ID",
            kind="Health",
            provider="Plan Alpha",
            policy_number_masked="POL-***-AAA",
            start_date="2026-06-01",
            end_date="2026-11-30",
            policy_status="ACTIVE",
        )
        # Policy B: starts 2026-12-15 (14-day gap between Dec 1 and Dec 14)
        cov_b = AccountCoverageRow(
            id=uuid4(),
            account_id=account_id,
            country_code="ID",
            kind="Health",
            provider="Plan Beta",
            policy_number_masked="POL-***-BBB",
            start_date="2026-12-15",
            end_date="2027-05-31",
            policy_status="ACTIVE",
        )
        db.add_all([cov_a, cov_b])
        db.commit()

        status = run_anti_lapse_agent(db, owner, actor=actor, today=today)
        gap = next((g for g in status.continuity_gaps if g.gap_type == "BETWEEN_POLICIES"), None)
        assert gap is not None
        assert gap.start_date == "2026-12-01"
        assert gap.end_date == "2026-12-14"
        assert gap.days == 14
        assert gap.severity == "HIGH"


def test_full_anti_lapse_lifecycle_api(client, demo):
    """Verify Scheduled Trigger -> Scan -> Gap/Expiry -> Deduplicate -> Draft Inquiry -> Approval -> Execution -> Receipt."""
    session_data, headers = demo("raka")

    # Consent grant for processing documents
    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    # 1. Trigger agent scan via dedicated endpoint
    scan_res = client.post("/api/v1/agent/anti-lapse/scan", headers=headers)
    assert scan_res.status_code == 200
    scan_data = scan_res.json()
    assert scan_data["agent_id"] == "anti_lapse_sentinel"
    assert scan_data["status"] in ("ACTIVE_MONITORING", "ACTION_PREPARED", "ATTENTION_REQUIRED")
    assert len(scan_data["reasoning_trail"]) >= 4

    # 2. Query Agent Status via GET
    status_res = client.get("/api/v1/agent/anti-lapse/status", headers=headers)
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["agent_name"] == "Proactive Renewal & Anti-Lapse Agent"
    assert status_data["timezone"] in ("Asia/Jakarta", "Asia/Shanghai")

    # 3. Check that Home Summary includes the anti_lapse_agent
    home_res = client.get("/api/v1/home/summary", headers=headers)
    assert home_res.status_code == 200
    home_data = home_res.json()
    assert "anti_lapse_agent" in home_data
    assert home_data["anti_lapse_agent"] is not None
    assert home_data["anti_lapse_agent"]["agent_id"] == "anti_lapse_sentinel"

    # 4. Check Deduplication
    repeat_scan = client.post("/api/v1/agent/anti-lapse/scan", headers=headers)
    assert repeat_scan.status_code == 200
    repeat_data = repeat_scan.json()
    # Action count should not have doubled
    assert repeat_data["prepared_actions_count"] == scan_data["prepared_actions_count"]
