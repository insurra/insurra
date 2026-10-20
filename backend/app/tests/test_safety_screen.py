"""Tests for the shared KB-driven safety screen and emergency contacts (B1.6)."""

from app.core.config import ROOT
from app.services.kb_loader import CountryKBLoader
from app.services.safety_screen import get_verified_emergency_contacts, screen


def test_safety_screen_matches_mandarin_indonesian_and_english_phrases():
    loader = CountryKBLoader(ROOT / "kb")
    for country_code in ("CN", "ID"):
        country = loader.load(country_code)

        # Medical red flags across zh, id, en (including negated phrases)
        for phrase in (
            "我今天胸痛很严重",
            "胸口剧痛",
            "呼吸困难",
            "nyeri dada berat",
            "tidak sesak napas",
            "severe chest pain",
            "no difficulty breathing",
        ):
            res = screen(country, phrase)
            assert res.red_flag is True, (country_code, phrase)
            assert res.category == "MEDICAL_EMERGENCY"
            assert "EMERGENCY_MEDICAL" in res.safety_flows
            assert res.screening_complete is False

        # Self-harm red flags across zh, id, en
        for phrase in (
            "想自杀",
            "ingin menyakiti diri sendiri",
            "want to hurt myself",
        ):
            res = screen(country, phrase)
            assert res.red_flag is True, (country_code, phrase)
            assert res.category == "SELF_HARM_RISK"
            assert "SELF_HARM_SUPPORT" in res.safety_flows
            assert res.screening_complete is False

        # Non-red-flag phrase is never medical clearance
        normal = screen(country, "Bagaimana prosedur klaim rawat jalan?")
        assert normal.red_flag is False
        assert normal.category == "NONE_DETECTED"
        assert normal.matched_flag_ids == []
        assert normal.screening_complete is False


def test_emergency_contacts_use_only_verified_kb_entries_with_no_hardcoded_fallbacks(client, demo):
    _, headers = demo("raka")
    cn = client.get("/api/v1/workflow/emergency/contacts?country_code=CN", headers=headers).json()
    assert cn["country_code"] == "CN"
    assert [c["phone_number"] for c in cn["contacts"]] == ["120", "110", "119"]
    # Hardcoded unsourced numbers (122, 010-82951332) must not appear
    assert "122" not in [c["phone_number"] for c in cn["contacts"]]
    assert cn["mental_health_crisis_line"] is None

    id_res = client.get(
        "/api/v1/workflow/emergency/contacts?country_code=ID", headers=headers
    ).json()
    assert id_res["country_code"] == "ID"
    assert [c["phone_number"] for c in id_res["contacts"]] == ["112", "119", "110", "113"]
    # Hardcoded unsourced numbers (115, 119 ext 8) must not appear
    assert "115" not in [c["phone_number"] for c in id_res["contacts"]]
    assert id_res["mental_health_crisis_line"] is None

    # Unverified AU KB produces empty contacts and available=False
    loader = CountryKBLoader(ROOT / "kb")
    au = get_verified_emergency_contacts(loader.load("AU"))
    assert au["available"] is False
    assert au["contacts"] == []
    assert au["primary_emergency_number"] is None
