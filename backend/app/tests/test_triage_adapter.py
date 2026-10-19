"""Tests for the triage adapter contract and fail-closed behavior (B1.7)."""

import copy

import pytest

from app.core.config import ROOT
from app.core.errors import AppError
from app.schemas.common import VerificationStatus
from app.services.kb_loader import CountryKBLoader
from app.services.triage_adapter import triage_check


def test_triage_adapter_accepts_valid_cn_and_id_kb():
    loader = CountryKBLoader(ROOT / "kb")
    for code in ("CN", "ID"):
        country = loader.load(code)
        safe = triage_check(country, "Bagaimana cara klaim rawat jalan?")
        assert safe.red_flag is False
        assert safe.screening_complete is False

        medical = triage_check(country, "Saya mengalami nyeri dada berat")
        assert medical.red_flag is True
        assert "EMERGENCY_MEDICAL" in medical.safety_flows

        chinese = triage_check(country, "今天突然呼吸困难")
        assert chinese.red_flag is True
        assert "EMERGENCY_MEDICAL" in chinese.safety_flows

        self_harm = triage_check(country, "Saya ingin menyakiti diri sendiri")
        assert self_harm.red_flag is True
        assert "SELF_HARM_SUPPORT" in self_harm.safety_flows


def test_triage_adapter_fails_closed_for_broken_or_unverified_kb():
    loader = CountryKBLoader(ROOT / "kb")

    # 1. Inactive/unverified AU KB fails closed
    au = loader.load("AU")
    with pytest.raises(AppError) as exc:
        triage_check(au, "chest pain")
    assert exc.value.status_code == 503
    assert exc.value.code == "TRIAGE_UNAVAILABLE"

    # 2. Untrusted source host fails closed
    cn_bad_host = copy.deepcopy(loader.load("CN"))
    cn_bad_host.manifest.official_source_hosts = []
    with pytest.raises(AppError) as exc:
        triage_check(cn_bad_host, "chest pain")
    assert exc.value.status_code == 503
    assert exc.value.code == "TRIAGE_UNAVAILABLE"

    # 3. Unknown destination_code fails closed
    cn_bad_dest = copy.deepcopy(loader.load("CN"))
    cn_bad_dest.resources.red_flags.data[0].destination_code = "unknown_dest"
    with pytest.raises(AppError) as exc:
        triage_check(cn_bad_dest, "chest pain")
    assert exc.value.status_code == 503
    assert exc.value.code == "TRIAGE_UNAVAILABLE"

    # 4. Unverified envelope fails closed
    cn_unverified = copy.deepcopy(loader.load("CN"))
    cn_unverified.resources.red_flags.verification_status = VerificationStatus.UNVERIFIED
    with pytest.raises(AppError) as exc:
        triage_check(cn_unverified, "chest pain")
    assert exc.value.status_code == 503
    assert exc.value.code == "TRIAGE_UNAVAILABLE"
