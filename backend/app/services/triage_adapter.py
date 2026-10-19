"""Deterministic consumer of Joshua's reviewed triage contract, no medical KB invented."""

import re
import unicodedata

from app.core.errors import AppError
from app.schemas.foundation import TriageMatch, TriageResult
from app.services.command_center import checked_official


def normalized(text):
    return " ".join(re.findall(r"\w+", unicodedata.normalize("NFKC", text).casefold()))


def triage_check(country, text: str) -> TriageResult:
    resource = country.resources.red_flags
    if not resource.data or not checked_official(country, resource):
        raise AppError(
            503,
            "TRIAGE_UNAVAILABLE",
            "Pemeriksaan tanda bahaya belum tersedia. Jawaban polis dan perbandingan "
            "dihentikan. Periksa layanan darurat setempat bila membutuhkan bantuan segera.",
        )
    value = " " + normalized(text) + " "
    matched = []
    for flag in resource.data:
        phrases = [p for p in flag.phrases_id + flag.phrases_en if normalized(p)]
        if not phrases or flag.destination_code != "emergency":
            raise AppError(503, "TRIAGE_UNAVAILABLE", "Konfigurasi arahan darurat belum lengkap.")
        # Negation is intentionally not removed: it cannot cancel a deterministic hit.
        if any(" " + normalized(phrase) + " " in value for phrase in phrases):
            matched.append(
                TriageMatch(
                    id=flag.id,
                    kb_version=resource.version,
                    category=flag.category,
                    source_url=flag.source_url or resource.source_url,
                )
            )
    return TriageResult(
        red_flag=bool(matched),
        matched=matched,
        safety_flows=["EMERGENCY_MEDICAL"] if matched else [],
    )
