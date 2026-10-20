"""Opt-in synthetic support for the real-provider browser workflow only."""

from copy import deepcopy
from datetime import date

from app.schemas.common import VerificationStatus
from app.schemas.kb import RedFlagConfig


def install_test_triage(app) -> None:
    """Enable the SC-06 gate in this isolated test app without changing shipped KB data."""
    loader = app.state.kb_loader
    original_load = loader.load
    countries = {code: deepcopy(original_load(code)) for code in ("AU", "ID")}
    for country in countries.values():
        country.manifest.official_source_hosts.append("synthetic.example.test")
        resource = country.resources.red_flags
        resource.source_url = "https://synthetic.example.test/triage-contract"
        resource.checked_at = date(2026, 10, 18)
        resource.verification_status = VerificationStatus.VERIFIED
        resource.data = [
            RedFlagConfig(
                id="test_breathing",
                category="synthetic",
                phrases_id=["sesak napas", "sulit bernapas"],
                phrases_en=["shortness of breath", "difficulty breathing"],
                destination_code="emergency",
            ),
            RedFlagConfig(
                id="test_chest",
                category="synthetic",
                phrases_id=["nyeri dada"],
                phrases_en=["chest pain"],
                destination_code="emergency",
            ),
        ]

    def load(country_code: str):
        return countries[country_code] if country_code in countries else original_load(country_code)

    loader.load = load
