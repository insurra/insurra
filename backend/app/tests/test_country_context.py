"""Country edits invalidate residence assumptions without relabelling owned insurance data."""

import json
from uuid import UUID

import pytest

from app.core.config import ROOT
from app.models import DocumentRow
from app.schemas.insurance import UnifiedInsuranceRecord
from app.schemas.profile import UserProfile
from app.services.kb_loader import CountryKBLoader
from app.services.rules_engine import RulesEngine


@pytest.mark.parametrize(
    "persona,destination,residence,origin",
    [("raka", "ID", "DOMESTIC", "CN"), ("sinta", "CN", "ABROAD", "ID")],
)
def test_country_switch_preserves_origin_and_consent_but_rechecks_assessment(
    client, app, demo, persona, destination, residence, origin
):
    session, headers = demo(persona)
    before = client.get("/api/v1/insurance/record", headers=headers).json()
    purposes = client.get("/api/v1/consents", headers=headers).json()
    with app.state.session_factory() as db:
        document = DocumentRow(
            session_id=UUID(session["id"]),
            country_code=origin,
            kind="other",
            original_filename="synthetic.txt",
            sha256="a" * 64,
        )
        db.add(document)
        db.commit()
        document_id = document.id
    result = client.put(
        "/api/v1/profile",
        headers=headers,
        json={
            "country_code": destination,
            "residence_context": residence,
        },
    )
    assert result.status_code == 200
    assert result.json()["profile"]["country_code"] == destination
    assert result.json()["suggested_docs"] == []
    assert client.get("/api/v1/insurance/record", headers=headers).json() == before
    assert before["country_code"] == origin
    with app.state.session_factory() as db:
        document = db.get(DocumentRow, document_id)
        assert document.country_code == origin and document.sha256 == "a" * 64
        assert document.original_filename == "synthetic.txt"
    assert client.get("/api/v1/consents", headers=headers).json() == purposes
    assessment = client.get("/api/v1/assessments/visa-gap", headers=headers).json()
    assert assessment["assessment_status"] == "NEEDS_VERIFICATION"
    assert assessment["gap_days"] is None and assessment["gap_periods"] == []
    assert origin in assessment["explanation"] and destination in assessment["explanation"]
    assert assessment["rule_source"] is None
    events = client.get("/api/v1/audit?event_type=PROFILE_UPDATED", headers=headers).json()
    assert len(events) == 1
    assert events[0]["metadata"] == {}  # No profile contents enter audit.


def test_country_round_trip_requires_new_country_details_before_reusing_gap(client, demo):
    _, headers = demo()
    original = client.get("/api/v1/profile", headers=headers).json()
    metadata = {
        "timezone": "Asia/Shanghai",
        "institution_name": "Synthetic",
        "budget_range": "synthetic-range",
        "currency": "CNY",
        "dependents": ["synthetic"],
        "priorities": ["synthetic"],
        "owned_coverage": ["synthetic"],
    }
    assert client.put("/api/v1/profile", headers=headers, json=metadata).status_code == 200
    reset_fields = (
        "city",
        "timezone",
        "institution_name",
        "arrival_date",
        "visa_expiry_date",
        "budget_range",
        "currency",
        "study_start_date",
        "study_end_date",
        "permit_end_date",
    )
    for country, residence in [("ID", "DOMESTIC"), ("CN", "ABROAD")]:
        response = client.put(
            "/api/v1/profile",
            headers=headers,
            json={
                "country_code": country,
                "residence_context": residence,
            },
        )
        assert response.status_code == 200
        profile = response.json()["profile"]
        assert all(profile[field] is None for field in reset_fields)
        for field in ("dependents", "priorities", "owned_coverage"):
            assert profile[field] == metadata[field]
        assessment = client.get("/api/v1/assessments/visa-gap", headers=headers).json()
        assert assessment["assessment_status"] == (
            "NEEDS_VERIFICATION" if country != original["country_code"] else "UNABLE_TO_DETERMINE"
        )
        assert assessment["gap_days"] is None and assessment["gap_periods"] == []
    # Explicitly re-entered dates can be used again once profile and record countries match.
    response = client.put(
        "/api/v1/profile",
        headers=headers,
        json={
            "arrival_date": original["arrival_date"],
            "study_start_date": original["study_start_date"],
            "study_end_date": original["study_end_date"],
            "permit_end_date": original["permit_end_date"],
            "visa_expiry_date": original["visa_expiry_date"],
        },
    )
    assert response.status_code == 200
    assert client.get("/api/v1/assessments/visa-gap", headers=headers).json()["gap_days"] == 76


def test_same_country_merge_and_explicit_destination_details(client, demo):
    _, headers = demo()
    before = client.get("/api/v1/profile", headers=headers).json()
    same = client.put(
        "/api/v1/profile", headers=headers, json={"country_code": "CN", "city": "Synthetic"}
    )
    assert same.status_code == 200
    assert same.json()["profile"]["visa_expiry_date"] == before["visa_expiry_date"]
    explicit = {
        "country_code": "ID",
        "residence_context": "DOMESTIC",
        "city": "Synthetic",
        "timezone": "Asia/Jakarta",
        "currency": "IDR",
        "budget_range": "synthetic",
    }
    switched = client.put("/api/v1/profile", headers=headers, json=explicit)
    assert switched.status_code == 200
    assert all(switched.json()["profile"][key] == value for key, value in explicit.items())
    saved = client.get("/api/v1/profile", headers=headers).json()
    failure = client.put("/api/v1/profile", headers=headers, json={"country_code": "ZZ"})
    assert failure.status_code == 422
    assert client.get("/api/v1/profile", headers=headers).json() == saved
    assert len(client.get("/api/v1/audit?event_type=PROFILE_UPDATED", headers=headers).json()) == 2


@pytest.mark.parametrize("destination,origin", [("ID", "CN"), ("CN", "ID")])
def test_foreign_record_is_not_a_pass_or_non_applicability_fallback(destination, origin):
    profile = UserProfile.model_validate_json((ROOT / "fixtures/raka/profile.json").read_text())
    record = UnifiedInsuranceRecord.model_validate_json(
        (ROOT / "fixtures/raka/insurance_record.json").read_text()
    )
    profile.country_code = destination
    record.country_code = origin
    before = json.dumps(record.model_dump(mode="json"), sort_keys=True)
    result = RulesEngine(CountryKBLoader(ROOT / "kb")).assess_visa_coverage(profile, record)
    assert result.assessment_status == "NEEDS_VERIFICATION"
    assert result.gap_days is None and result.gap_periods == []
    assert result.rule_source is None
    assert json.dumps(record.model_dump(mode="json"), sort_keys=True) == before
