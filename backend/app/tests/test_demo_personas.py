"""Demo persona migration: Raka in Shenzhen (synthetic), Sinta in Jakarta, AU inactive."""

import json
import re
from datetime import date
from uuid import UUID

import pytest
from sqlalchemy import select

from app.core.config import ROOT
from app.models import PersonaRow
from app.seeds.demo import seed_personas
from app.workflow.models import WfClaimCaseRow

LEGACY = re.compile(r"\bAU\b|OSHC|8501|\bAUD\b|Melbourne|Australia|subclass", re.IGNORECASE)
DEMO_PLAN = "Synthetic Student Health Plan (demo, not a real insurer product)"
VISA_WORDING = re.compile(r"breach|violation|illegal|overstay|visa gap|visa violation", re.I)


def get_json(client, path, headers, ok=(200,)):
    response = client.get(path, headers=headers)
    assert response.status_code in ok, (path, response.text)
    return response.json() if response.status_code == 200 else None


def test_countries_list_only_active_markets(client):
    countries = client.get("/api/v1/countries").json()
    assert {c["country_code"] for c in countries} == {"CN", "ID"}
    by_code = {c["country_code"]: c for c in countries}
    assert by_code["CN"]["default_timezone"] == "Asia/Shanghai"
    assert by_code["CN"]["default_currency"] == "CNY"
    assert by_code["ID"]["default_timezone"] == "Asia/Jakarta"
    assert by_code["ID"]["default_currency"] == "IDR"
    assert (ROOT / "kb/AU/manifest.json").is_file()
    assert client.get("/api/v1/countries/AU").status_code in (404, 405, 422)


def test_inactive_country_cannot_be_loaded(app):
    from app.core.errors import AppError

    with pytest.raises(AppError) as caught:
        app.state.kb_loader.load("AU")
    assert caught.value.code == "UNSUPPORTED_COUNTRY"


def test_personas_endpoint_extended_fields(client):
    personas = {p["persona_id"]: p for p in client.get("/api/v1/demo/personas").json()}
    assert set(personas) == {"raka", "sinta"}
    raka, sinta = personas["raka"], personas["sinta"]
    assert raka["country_code"] == "CN" and raka["city"] == "Shenzhen"
    assert raka["role_label"] == "International Student in China"
    assert raka["insurance_categories"] == ["INTERNATIONAL_STUDENT"]
    assert raka["description"] == (
        "Discover your student insurance, review coverage dates, and prepare next steps."
    )
    assert sinta["country_code"] == "ID" and sinta["city"] == "Jakarta"
    assert sinta["role_label"] == "Employee in Indonesia"
    assert sinta["insurance_categories"] == ["PUBLIC_SOCIAL_HEALTH", "EMPLOYER_GROUP"]
    assert sinta["description"] == "Understand public and employer insurance in one place."
    assert all(p["is_synthetic"] is True and p["synthetic"] is True for p in personas.values())
    taxonomy = json.loads((ROOT / "kb/global/insurance_taxonomy.json").read_text())
    codes = {c["category_code"] for c in taxonomy["categories"]}
    assert all(set(p["insurance_categories"]) <= codes for p in personas.values())


def test_seed_is_idempotent_and_upserts_changed_content(app, tmp_path):
    with app.state.session_factory() as db:
        assert seed_personas(db) == 0
        row = db.get(PersonaRow, "raka")
        row.description = "stale description"
        row.profile_payload = {**row.profile_payload, "city": "Stale"}
        db.commit()
        assert seed_personas(db) == 1
        assert seed_personas(db) == 0
        row = db.scalar(select(PersonaRow).where(PersonaRow.persona_id == "raka"))
        db.refresh(row)
        assert row.profile_payload["city"] == "Shenzhen"
        assert row.description.startswith("Discover your student insurance")
        assert db.query(PersonaRow).count() == 2


def test_raka_session_is_china_synthetic_without_legacy_strings(client, demo):
    _, headers = demo("raka")
    assert (
        client.put(
            "/api/v1/consent", headers=headers, json={"processing_consent": True}
        ).status_code
        == 200
    )
    profile = get_json(client, "/api/v1/profile", headers)
    assert profile["display_name"] == "Raka" and profile["city"] == "Shenzhen"
    assert profile["country_code"] == "CN" and profile["residence_context"] == "ABROAD"
    assert profile["occupation"] == "STUDENT" and profile["currency"] == "CNY"
    assert profile["timezone"] == "Asia/Shanghai"
    assert profile["institution_name"] == "Shenzhen Demo International University (synthetic)"
    assert profile["study_start_date"] == "2026-09-01"
    assert profile["study_end_date"] == "2027-06-30"
    assert profile["arrival_date"] == "2026-08-25"
    record = get_json(client, "/api/v1/insurance/record", headers)
    assert record["country_code"] == "CN"
    (policy,) = record["policies"]
    assert policy["policy_type"] == "INTERNATIONAL_STUDENT"
    assert policy["provider_name"] == DEMO_PLAN and policy["policy_name"] == DEMO_PLAN
    assert policy["coverage_start_date"] == "2026-09-01"
    assert policy["coverage_end_date"] == "2027-04-15"
    assert policy["verification_status"] == "UNVERIFIED"
    assert all(
        item["coverage_status"] == "UNKNOWN" and item["currency"] == "CNY"
        for item in policy["coverage_items"]
    )
    assert all(d["synthetic"] for d in record["documents"])
    client.get("/api/v1/assessments/visa-gap", headers=headers)
    payloads = {
        "profile": profile,
        "record": record,
        "audit": get_json(client, "/api/v1/audit", headers),
        "claims": get_json(client, "/api/v1/workflow/claims/cases", headers),
        "overview": get_json(client, "/api/v1/workflow/claims/overview", headers),
        "actions": get_json(client, "/api/v1/actions", headers),
        "home": get_json(client, "/api/v1/home/summary", headers, ok=(200, 403, 409)),
    }
    for name, payload in payloads.items():
        text = json.dumps(payload, ensure_ascii=False)
        assert not LEGACY.search(text), (name, LEGACY.search(text).group(0))


def test_raka_76_day_inclusive_interval_requires_review(client, demo):
    _, headers = demo("raka")
    result = get_json(client, "/api/v1/assessments/visa-gap", headers)
    assert result["gap_days"] == 76
    assert result["gap_periods"] == [{"start_date": "2027-04-16", "end_date": "2027-06-30"}]
    assert (date(2027, 6, 30) - date(2027, 4, 16)).days + 1 == 76
    assert result["assessment_status"] == "NEEDS_VERIFICATION"
    assert result["requirement_status"] == "NEEDS_VERIFICATION"
    assert result["explanation"] == "Coverage dates require review."
    assert not VISA_WORDING.search(json.dumps(result))
    source = result["rule_source"]
    assert source["verification_status"] == "UNVERIFIED" and source["source_url"] is None
    assert source["country_code"] == "CN"


def test_raka_university_requirement_is_never_treated_as_verified(client, demo):
    _, headers = demo("raka")
    result = get_json(client, "/api/v1/assessments/visa-gap", headers)
    assert result["requirement_status"] != "VERIFIED"
    assert result["assessment_status"] not in {"GAP_FOUND", "POTENTIAL_COVERAGE_GAP"}


def test_raka_claim_seed_is_consistent_with_policy(client, demo, db_session):
    session, headers = demo("raka")
    rows = (
        db_session.query(WfClaimCaseRow)
        .filter_by(owner_kind="DEMO", owner_id=UUID(session["id"]))
        .all()
    )
    assert rows and {r.country_code for r in rows} == {"CN"}
    hero = next(r for r in rows if r.reference == "CLM-2026-001")
    assert hero.claimant_name == "Raka" and hero.currency == "CNY" and hero.is_synthetic
    assert hero.coverage_label == DEMO_PLAN and hero.policy_end == "2027-04-15"
    for row in rows:
        assert row.currency == "CNY" and row.claimant_name == "Raka"
        assert date(2026, 9, 1) <= date.fromisoformat(row.service_date) <= date(2027, 4, 15)
    cases = get_json(client, "/api/v1/workflow/claims/cases", headers)["cases"]
    detail = get_json(client, f"/api/v1/workflow/claims/cases/{hero.id}", headers)
    assert len(cases) == len(rows)
    text = json.dumps(detail["case"], ensure_ascii=False)
    assert "2027-08-31" not in text and "Ping An" not in text and "HealthPlus" not in text


def test_sinta_is_preserved_with_separate_public_and_employer_coverage(client, demo):
    _, headers = demo("sinta")
    profile = get_json(client, "/api/v1/profile", headers)
    assert profile["country_code"] == "ID" and profile["city"] == "Jakarta"
    assert profile["occupation"] == "EMPLOYEE"
    record = get_json(client, "/api/v1/insurance/record", headers)
    assert record["country_code"] == "ID"
    policies = {p["policy_type"]: p for p in record["policies"]}
    assert set(policies) == {"BPJS", "EMPLOYER"}
    assert policies["BPJS"]["id"] != policies["EMPLOYER"]["id"]
    for policy in policies.values():
        assert policy["verification_status"] == "UNVERIFIED"
        for item in policy["coverage_items"]:
            assert item["coverage_status"] == "UNKNOWN"
            assert item["currency"] == "IDR"
            assert item["limit_amount"] is None and item["remaining_amount"] is None
    assert not LEGACY.search(json.dumps(record))
    result = get_json(client, "/api/v1/assessments/visa-gap", headers)
    assert result["assessment_status"] == "UNABLE_TO_DETERMINE" and result["gap_days"] is None


def test_demo_sessions_are_isolated_and_fresh(client, demo):
    first, ha = demo("raka")
    second, hb = demo("raka")
    assert first["session_token"] != second["session_token"]
    pa = get_json(client, "/api/v1/profile", ha)
    pb = get_json(client, "/api/v1/profile", hb)
    assert pa["id"] != pb["id"]
    update = {k: v for k, v in pa.items() if k not in {"id", "created_at", "updated_at"}}
    update["city"] = "Guangzhou"
    assert client.put("/api/v1/profile", headers=ha, json=update).status_code == 200
    assert get_json(client, "/api/v1/profile", hb)["city"] == "Shenzhen"
    cases_a = get_json(client, "/api/v1/workflow/claims/cases", ha)["cases"]
    cases_b = get_json(client, "/api/v1/workflow/claims/cases", hb)["cases"]
    assert {c["id"] for c in cases_a}.isdisjoint({c["id"] for c in cases_b})


def test_fixture_files_contain_no_legacy_scenario():
    for path in (ROOT / "fixtures/raka").iterdir():
        assert not LEGACY.search(path.read_text(encoding="utf-8")), path.name
    cert = (ROOT / "fixtures/raka/student-insurance-certificate-synthetic.txt").read_text()
    fapiao = (ROOT / "fixtures/raka/medical-fapiao-synthetic.txt").read_text()
    assert "合成" in cert and "2026-09-01" in cert and "2027-04-15" in cert
    assert "Raka" in fapiao and "2026-10-12" in fapiao and "450.00 CNY" in fapiao


def test_active_kb_countries_setting_gates_discovery_and_loading():
    from app.core.config import Settings
    from app.services.kb_loader import CountryKBLoader

    assert Settings().active_kb_country_codes == frozenset({"CN", "ID"})
    narrow = CountryKBLoader(
        ROOT / "kb", Settings(active_kb_countries="id").active_kb_country_codes
    )
    assert [m.country_code for m in narrow.discover()] == ["ID"]
    wide = CountryKBLoader(
        ROOT / "kb", Settings(active_kb_countries="AU,CN").active_kb_country_codes
    )
    assert [m.country_code for m in wide.discover()] == ["AU", "CN"]
    assert wide.load("AU").manifest.country_code == "AU"
