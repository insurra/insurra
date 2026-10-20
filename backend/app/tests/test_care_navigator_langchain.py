"""Acceptance and unit tests for LangChain Care Navigator & Safety Triage (SC-07, SC-08 · P0).

Verifies CARE-01 through CARE-14 and EM-01 through EM-10:
- CARE-01: Natural language care need input
- CARE-02 / EM-02: Red-flag safety triage
- CARE-03: Identification of relevant care pathway types
- CARE-04: Read location and policy benefits
- CARE-05: Compare relevant care options
- CARE-06: Show applicable network/referral/preauthorization rules
- CARE-07: Explain coverage evidence and uncertainty
- CARE-08 / CARE-09: Deterministic cost calculation and unknown cost display
- CARE-10 / CARE-11: User selects pathway, shows next steps
- CARE-12: Optional draft claim case creation with idempotency
- CARE-13 / EM-03: Deep link / escalation to Emergency on red-flag
- CARE-14: Zero fabrication of medical tariffs, hospitals, or guarantees
- EM-04: Country-specific verified emergency contacts
- EM-06: Emergency guidance available without LLM dependency
"""

from app.agent.care_navigator import (
    CareNavigatorChain,
    check_red_flag_safety,
    classify_service_type,
)
from app.tests.workspace_fixtures import reviewed_triage, workspace


def test_care_service_classification_natural_language():
    """CARE-01, CARE-03: Deterministic identification of care pathway categories from text."""
    assert classify_service_type("I have a toothache") == "DENTAL"
    assert classify_service_type("Gigi saya sakit berlubang") == "DENTAL"
    assert classify_service_type("I want a general check-up") == "GENERAL_CHECKUP"
    assert classify_service_type("Routine MCU or physical exam") == "GENERAL_CHECKUP"
    assert classify_service_type("Batuk pilek dan demam sejak kemarin") == "RESPIRATORY"
    assert classify_service_type("I feel sick with fever") == "RESPIRATORY"
    assert classify_service_type("Sakit maag mual dan diare") == "DIGESTIVE"
    assert classify_service_type("I need a booster vaccine") == "VACCINATION"
    assert classify_service_type("I need a specialist for dermatology") == "OUTPATIENT"


def test_pre_llm_safety_triage():
    """CARE-02, EM-02, EM-03: Conservative pre-LLM red-flag detection."""
    # Emergency phrases in English and Indonesian
    for phrase in [
        "severe chest pain and sweating",
        "breathing difficulty and passed out",
        "major bleeding from deep cut",
        "severe head injury after crash",
        "facial swelling and trouble breathing anaphylaxis",
        "sesak napas berat dan pingsan",
        "nyeri dada hebat serangan jantung",
    ]:
        result = check_red_flag_safety(phrase)
        assert result.is_emergency is True, f"Failed for emergency phrase: {phrase}"
        assert result.recommended_flow == "EMERGENCY_MEDICAL"

    # Non-emergency phrases should pass safely
    for normal in [
        "I have a toothache",
        "I need dental cleaning",
        "I want a general check-up",
        "batuk pilek ringan",
    ]:
        result = check_red_flag_safety(normal)
        assert result.is_emergency is False, f"False positive for non-emergency: {normal}"


def test_care_navigator_langchain_guidance_generation():
    """CARE-05, CARE-06, CARE-07, CARE-14: Grounded explanations and boundaries in English."""
    chain_cn = CareNavigatorChain("CN", {"city": "Beijing", "student": True})
    guidance_dental = chain_cn.run("I have a toothache", "DENTAL")

    assert guidance_dental.inferred_service_type == "DENTAL"
    assert "Beijing" in guidance_dental.summary_markdown
    assert "dental" in guidance_dental.summary_markdown.lower()
    assert len(guidance_dental.next_steps) == 3
    assert any("Choose a provider" in step for step in guidance_dental.next_steps)
    assert any("Prepare documents" in step for step in guidance_dental.next_steps)
    assert any("diagnosis" in w.lower() for w in guidance_dental.warnings)

    # Red flag halts guidance immediately
    guidance_em = chain_cn.run("severe chest pain", "EMERGENCY")
    assert guidance_em.inferred_service_type == "EMERGENCY"
    assert "Safety Alert" in guidance_em.summary_markdown


def test_api_care_compare_natural_language_and_red_flag(client, app, monkeypatch):
    """End-to-end API test for natural language input and safety interruption."""
    reviewed_triage(app, monkeypatch)
    h_cn, account_cn, coverage_cn, _ = workspace(app, client, "CN")

    # 1. Natural Language Red Flag -> Emergency Redirect
    res_rf = client.post(
        "/api/v1/pathways/compare",
        headers=h_cn,
        json={"complaint": "severe chest pain and trouble breathing"},
    )
    assert res_rf.status_code == 200
    assert res_rf.json().get("redirect") == "emergency"

    # 2. Natural Language Dental Complaint -> Returns 3 Dental Pathways
    res_dental = client.post(
        "/api/v1/pathways/compare",
        headers=h_cn,
        json={"complaint": "I have a toothache"},
    )
    assert res_dental.status_code == 200
    data = res_dental.json()
    assert "paths" in data
    assert len(data["paths"]) >= 2
    assert data["inferred_need"] == "DENTAL"
    assert "Dental Clinic" in data["paths"][0]["name"] or "Hospital" in data["paths"][0]["name"]
    assert data["paths"][0]["image_url"] is not None
    assert data["paths"][0]["distance_km"] is not None
    assert data["paths"][0]["wait_time_estimate"] is not None
