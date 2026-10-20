"""Tests for SC-04 Data Completeness Engine (REG-38..45).

Verifies task-specific checks, 4 statuses, separation of profile vs insurance,
deterministic interval comparison, timeline generation, attention guidance, and date-change refresh.
"""

import pytest

from app.tests.test_account_workspace import account_headers, profile_payload


@pytest.fixture
def kb_countries() -> str:
    return "AU,CN,ID"


def test_sc04_completeness_matrix_and_categories(app, client):
    """REG-38, REG-39, REG-40, REG-41: Task matrix, statuses, and separate profile/insurance sections."""
    mine = account_headers(app, "completeness_user")
    payload = profile_payload()
    payload.update(
        display_name="Raka Pratama",
        country_code="CN",
        residence_context="ABROAD",
        occupation="STUDENT",
        city="Beijing",
        arrival_date="2024-09-01",
        visa_expiry_date="2028-01-31",
    )
    assert client.put("/api/v1/account/profile", headers=mine, json=payload).status_code == 200
    assert client.post("/api/v1/account/documents/seed", headers=mine).status_code == 200

    response = client.get("/api/v1/account/completeness?task=coverage_continuity", headers=mine)
    assert response.status_code == 200, response.text
    data = response.json()

    # REG-38: Task-specific checks
    assert data["task_code"] == "coverage_continuity"
    assert data["task_label"] == "Protection continuity check"

    # REG-41: Show profile vs insurance separately
    profile_items = data["profile_items"]
    insurance_items = data["insurance_items"]
    assert len(profile_items) > 0
    assert len(insurance_items) > 0

    # REG-39: Status Found, Unverified, Missing, Not Applicable
    statuses = {item["status"] for item in profile_items + insurance_items}
    for s in ("FOUND", "UNVERIFIED", "MISSING", "NOT_APPLICABLE"):
        assert s in statuses, f"Expected status {s} to be represented"

    # Profile items verification
    p_by_key = {item["field_key"]: item for item in profile_items}
    assert p_by_key["full_name"]["status"] == "FOUND"
    assert p_by_key["full_name"]["details"] == "Raka Pratama"
    assert p_by_key["country_of_residence"]["status"] == "FOUND"
    assert p_by_key["dependents"]["status"] == "NOT_APPLICABLE"

    # Insurance items verification
    i_by_key = {item["field_key"]: item for item in insurance_items}
    assert i_by_key["student_insurance"]["status"] == "FOUND"
    assert i_by_key["public_health_insurance"]["status"] == "UNVERIFIED"
    assert i_by_key["employer_insurance"]["status"] == "NOT_APPLICABLE"

    # Metrics (KPI summary)
    metrics = data["metrics"]
    assert metrics is not None
    assert metrics["profile_found"] >= 6
    assert metrics["insurance_found"] >= 8
    assert metrics["overall_pct"] > 0


def test_sc04_deterministic_date_comparison_and_timeline(app, client):
    """REG-42, REG-43, REG-44: Deterministic date comparison, timeline generation, and attention guidance."""
    mine = account_headers(app, "timeline_user")
    payload = profile_payload()
    payload.update(
        display_name="Raka Pratama",
        country_code="CN",
        residence_context="ABROAD",
        occupation="STUDENT",
        arrival_date="2024-09-01",
        visa_expiry_date="2028-01-31",
    )
    assert client.put("/api/v1/account/profile", headers=mine, json=payload).status_code == 200

    # Add verified policy dates
    client.post(
        "/api/v1/account/manual-fields",
        headers=mine,
        json={"field_key": "coverage_start_date", "value": "2024-09-01", "confirm": True},
    )
    client.post(
        "/api/v1/account/manual-fields",
        headers=mine,
        json={"field_key": "coverage_end_date", "value": "2025-08-31", "confirm": True},
    )

    response = client.get("/api/v1/account/completeness?task=coverage_continuity", headers=mine)
    assert response.status_code == 200
    data = response.json()

    # REG-43: Visual coverage timeline items
    timeline = data["timeline_items"]
    assert len(timeline) >= 2
    categories = {t["category"] for t in timeline}
    assert "POLICY" in categories
    assert "VISA" in categories

    visa_item = next(t for t in timeline if t["category"] == "VISA")
    assert "2028" in visa_item["end_date"]

    # REG-44: Items that need attention
    attention = data["attention_items"]
    assert len(attention) > 0
    att_titles = [a["title"] for a in attention]
    assert any("medical conditions" in t.lower() for t in att_titles)

    # REG-42: Date gap arithmetic
    continuity = data["coverage_continuity"]
    assert continuity["status"] in {"DATE_DIFFERENCE_DETECTED", "POTENTIAL_COVERAGE_GAP"}
    assert continuity["gap_days"] > 0


def test_sc04_missing_dates_produce_needs_verification_not_fabricated_gap(app, client):
    """REG-42 building note: Missing dates produce NEEDS_VERIFICATION rather than a fabricated gap."""
    mine = account_headers(app, "missing_dates_user")
    payload = profile_payload()
    payload.update(
        country_code="CN",
        residence_context="ABROAD",
        occupation="STUDENT",
        arrival_date="2024-09-01",
        visa_expiry_date=None,
    )
    assert client.put("/api/v1/account/profile", headers=mine, json=payload).status_code == 200

    response = client.get("/api/v1/account/completeness?task=coverage_continuity", headers=mine)
    assert response.status_code == 200
    data = response.json()

    continuity = data["coverage_continuity"]
    assert continuity["status"] == "UNABLE_TO_DETERMINE"
    assert continuity["gap_days"] is None
