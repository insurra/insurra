"""Triage adapter contract and fail-closed behavior for reviewed and draft KB rules."""

import copy

import pytest

from app.core.config import ROOT
from app.core.errors import AppError
from app.schemas.common import VerificationStatus
from app.services.kb_loader import CountryKBLoader
from app.services.safety_screen import get_verified_emergency_contacts
from app.services.triage_adapter import triage_check


def test_reviewed_cn_rules_match_and_escalate_to_verified_emergency_contacts():
    loader = CountryKBLoader(ROOT / "kb")
    country = loader.load("CN")

    safe = triage_check(country, "Bagaimana cara klaim rawat jalan?")
    assert safe.red_flag is False
    assert safe.screening_complete is False

    medical = triage_check(country, "Saya mengalami nyeri dada berat")
    assert medical.red_flag is True
    assert "EMERGENCY_MEDICAL" in medical.safety_flows

    contacts = get_verified_emergency_contacts(country)
    assert contacts["available"] is True
    assert any(contact["service_code"] == "medical" for contact in contacts["contacts"])


def test_id_unverified_draft_rules_are_not_used_with_reviewed_rules():
    loader = CountryKBLoader(ROOT / "kb")
    country = loader.load("ID")
    assert any(
        rule.verification_status == VerificationStatus.UNVERIFIED
        for rule in country.resources.red_flags.data
    )

    reviewed = triage_check(country, "I have severe chest pain")
    assert reviewed.red_flag is True
    assert "EMERGENCY_MEDICAL" in reviewed.safety_flows

    draft_only = triage_check(country, "I lost consciousness")
    assert draft_only.red_flag is False
    assert draft_only.screening_complete is False


def test_triage_adapter_fails_closed_for_missing_red_flags():
    loader = CountryKBLoader(ROOT / "kb")
    missing = copy.deepcopy(loader.load("CN"))
    missing.resources.red_flags.data = []

    with pytest.raises(AppError) as exc:
        triage_check(missing, "chest pain")

    assert exc.value.status_code == 503
    assert exc.value.code == "TRIAGE_UNAVAILABLE"


def test_triage_adapter_fails_closed_for_unverified_or_invalid_kb():
    loader = CountryKBLoader(ROOT / "kb")

    # The inactive AU draft remains unavailable under the master CN/ID scope.
    with pytest.raises(AppError) as exc:
        triage_check(loader.load("AU"), "chest pain")
    assert exc.value.status_code == 503
    assert exc.value.code == "TRIAGE_UNAVAILABLE"

    cn_bad_host = copy.deepcopy(loader.load("CN"))
    cn_bad_host.manifest.official_source_hosts = []
    with pytest.raises(AppError) as exc:
        triage_check(cn_bad_host, "chest pain")
    assert exc.value.status_code == 503
    assert exc.value.code == "TRIAGE_UNAVAILABLE"

    cn_bad_dest = copy.deepcopy(loader.load("CN"))
    cn_bad_dest.resources.red_flags.data[0].destination_code = "unknown_dest"
    with pytest.raises(AppError) as exc:
        triage_check(cn_bad_dest, "chest pain")
    assert exc.value.status_code == 503
    assert exc.value.code == "TRIAGE_UNAVAILABLE"

    cn_unverified = copy.deepcopy(loader.load("CN"))
    cn_unverified.resources.red_flags.verification_status = VerificationStatus.UNVERIFIED
    with pytest.raises(AppError) as exc:
        triage_check(cn_unverified, "chest pain")
    assert exc.value.status_code == 503
    assert exc.value.code == "TRIAGE_UNAVAILABLE"
