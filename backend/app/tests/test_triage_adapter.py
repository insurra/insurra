"""Reviewed triage contract behavior; synthetic rules never become production guidance."""

import pytest

from app.core.errors import AppError
from app.schemas.common import VerificationStatus
from app.services.triage_adapter import triage_check
from app.tests.workspace_fixtures import reviewed_triage


@pytest.mark.parametrize("country_code", ["AU", "ID"])
def test_reviewed_rule_matches_only_from_explicit_reviewed_fixture(app, monkeypatch, country_code):
    countries = reviewed_triage(app, monkeypatch)

    result = triage_check(countries[country_code], "I have shortness of breath")

    assert result.red_flag
    assert result.matched[0].id == "test_breathing"
    assert result.matched[0].kb_version == "0.3.1"


@pytest.mark.parametrize("country_code", ["AU", "ID"])
def test_source_backed_drafts_stay_unavailable_until_reviewed(app, country_code):
    country = app.state.kb_loader.load(country_code)
    resource = country.resources.red_flags
    assert resource.data
    assert resource.checked_at
    assert resource.source_url
    assert resource.verification_status == VerificationStatus.UNVERIFIED

    with pytest.raises(AppError) as error:
        triage_check(country, "I have shortness of breath")

    assert error.value.status_code == 503
    assert error.value.code == "TRIAGE_UNAVAILABLE"


def test_empty_red_flag_resource_fails_closed_even_with_reviewed_metadata(app, monkeypatch):
    country = reviewed_triage(app, monkeypatch)["AU"]
    country.resources.red_flags.data = []

    with pytest.raises(AppError) as error:
        triage_check(country, "I have shortness of breath")

    assert error.value.status_code == 503
    assert error.value.code == "TRIAGE_UNAVAILABLE"
