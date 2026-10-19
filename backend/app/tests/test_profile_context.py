"""Profile v2 fields and the unified GET /api/v1/context read model."""

import pytest
from pydantic import ValidationError

from app.schemas.profile import ProfileData
from app.tests.test_account_workspace import account_headers


@pytest.fixture
def kb_countries() -> str:
    # Settings override scoped to this module: it uses the inactive legacy kb/AU folder as a
    # fixture-only configuration. The default app keeps AU disabled (see conftest).
    return "AU,CN,ID"


ACCOUNT = "/api/v1/account/profile"


def profile_payload() -> dict:
    return {
        "display_name": "Rere",
        "residence_context": "ABROAD",
        "country_code": "CN",
        "occupation": "STUDENT",
        "city": "Shanghai",
        "arrival_date": "2026-10-01",
        "visa_expiry_date": "2027-10-01",
    }


def test_old_payload_still_validates():
    profile = ProfileData.model_validate(profile_payload())
    assert profile.goals == [] and profile.situation is None and profile.nationality is None


def test_new_fields_map_and_mirror():
    profile = ProfileData.model_validate(
        {
            "display_name": "Rere",
            "residence_context": "ABROAD",
            "country_code": "CN",
            "situation": "SELF_EMPLOYED",
            "nationality": "IN",
            "permit_end_date": "2027-01-01",
            "goals": ["FIND_CARE"],
            "protection_scope": ["SELF", "SPOUSE"],
        }
    )
    assert profile.occupation.value == "OTHER"
    assert str(profile.visa_expiry_date) == "2027-01-01"


@pytest.mark.parametrize(
    "extra",
    [
        {"study_start_date": "2026-05-01", "study_end_date": "2026-04-01"},
        {"goals": ["FIND_CARE", "FIND_CARE"]},
        {"goals": ["NOPE"]},
        {"situation": "EMPLOYEE"},  # conflicts with occupation STUDENT
        {"nationality": "XYZ"},
        {"protection_scope": ["SELF", "SELF"]},
    ],
)
def test_invalid_new_fields(extra):
    with pytest.raises(ValidationError):
        ProfileData.model_validate({**profile_payload(), **extra})


def test_account_profile_roundtrip_and_inactive_country(app, client):
    headers = account_headers(app, "ctx")
    body = {**profile_payload(), "nationality": "IN", "goals": ["DISCOVER_GAPS"]}
    saved = client.put(ACCOUNT, headers=headers, json=body)
    assert saved.status_code == 200, saved.text
    got = client.get(ACCOUNT, headers=headers).json()
    assert got["profile"]["nationality"] == "IN" and got["profile"]["goals"] == ["DISCOVER_GAPS"]
    bad = client.put(ACCOUNT, headers=headers, json={**profile_payload(), "country_code": "JP"})
    assert bad.status_code == 422
    assert set(bad.json()) >= {"code", "message", "request_id"} or "error" in bad.json()


def test_draft_is_partial_and_only_put_completes(app, client):
    headers = account_headers(app, "draft")
    draft = client.put(f"{ACCOUNT}/draft", headers=headers, json={"city": "Sydney"})
    assert draft.status_code == 200
    assert draft.json()["completed"] is False and draft.json()["profile"] is None
    ctx = client.get("/api/v1/context", headers=headers).json()
    assert ctx["onboarding_completed"] is False and ctx["profile_completed"] is False
    client.put(f"{ACCOUNT}/draft", headers=headers, json={"goals": ["FIND_CARE"]})
    assert client.get(ACCOUNT, headers=headers).json()["completed"] is False
    assert client.put(ACCOUNT, headers=headers, json=profile_payload()).json()["completed"] is True
    assert client.get("/api/v1/context", headers=headers).json()["profile_completed"] is True


def test_country_switch_clears_bound_fields_keeps_personal(app, client):
    headers = account_headers(app, "switch")
    body = {
        **profile_payload(),
        "nationality": "IN",
        "employer_name": "Acme",
        "goals": ["FIND_CARE"],
        "permit_end_date": "2027-10-01",
        "study_start_date": "2026-10-01",
        "study_end_date": "2027-06-01",
    }
    assert client.put(ACCOUNT, headers=headers, json=body).status_code == 200
    out = client.put(f"{ACCOUNT}/draft", headers=headers, json={"country_code": "ID"}).json()
    draft = out["draft"]
    for key in (
        "city",
        "permit_end_date",
        "study_start_date",
        "study_end_date",
        "visa_expiry_date",
    ):
        assert draft[key] is None
    assert draft["nationality"] == "IN" and draft["employer_name"] == "Acme"
    assert draft["goals"] == ["FIND_CARE"]


def test_context_account_and_demo_and_isolation(app, client, demo):
    mine = account_headers(app, "mine")
    other = account_headers(app, "other")
    body = {**profile_payload(), "situation": "STUDENT", "goals": ["FIND_CARE"], "currency": "CNY"}
    client.put(ACCOUNT, headers=mine, json=body)
    ctx = client.get("/api/v1/context", headers=mine).json()
    assert ctx["mode"] == "ACCOUNT" and ctx["is_synthetic"] is False
    assert ctx["email"].startswith("mine_") and ctx["email_verified"] is True
    assert ctx["residence_country"] == "CN" and ctx["currency"] == "CNY"
    assert ctx["situation"] == "STUDENT" and ctx["goals"] == ["FIND_CARE"]
    assert ctx["coverage_verified"] is False and ctx["fields_reviewed"] == 0
    leak = client.get("/api/v1/context", headers=other).json()
    assert (
        leak["residence_country"] is None and leak["goals"] == [] and leak["email"] != ctx["email"]
    )
    _, demo_headers = demo()
    d = client.get("/api/v1/context", headers=demo_headers).json()
    assert d["mode"] == "DEMO" and d["is_synthetic"] is True and d["persona_id"] == "raka"
    assert d["email"] is None and d["onboarding_completed"] is True


def test_context_requires_actor_and_rejects_ambiguity(app, client, demo):
    assert client.get("/api/v1/context").status_code in {401, 403}
    _, demo_headers = demo()
    both = {**demo_headers, **account_headers(app, "both")}
    assert client.get("/api/v1/context", headers=both).status_code == 422
