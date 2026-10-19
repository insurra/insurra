"""Shared KB-driven safety screen and emergency contact resolver (SC-06, SC-07, SC-08).

Provides a single deterministic multilingual red-flag screening engine across Bahasa Indonesia,
English, and Mandarin Chinese (`phrases_id`, `phrases_en`, `phrases_zh`), and serves verified
emergency contacts strictly from versioned KB data without hardcoded fallback numbers.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Literal

from app.core.config import ROOT
from app.core.errors import AppError
from app.schemas.common import Contract, VerificationStatus
from app.schemas.foundation import TriageMatch, TriageResult
from app.services.command_center import checked_official
from app.services.kb_loader import CountryKBLoader

VALID_DESTINATION_CODES = frozenset({"emergency", "medical", "safety_support"})
CJK_CHAR_RE = re.compile(r"[\u4e00-\u9fff]")

GUIDANCE_BY_CATEGORY = {
    "MEDICAL": (
        "Potential medical emergency detected. Call local emergency medical services immediately "
        "before pursuing insurance verification or claim paperwork."
    ),
    "SELF_HARM": (
        "Confidential support is available. Please connect with crisis support or emergency "
        "services immediately."
    ),
}


class SafetyResult(Contract):
    category: Literal["MEDICAL_EMERGENCY", "SELF_HARM_RISK", "NONE_DETECTED"]
    matched_flag_ids: list[str]
    screening_complete: Literal[False] = False
    red_flag: bool = False
    matched: list[TriageMatch] = []
    safety_flows: list[Literal["EMERGENCY_MEDICAL", "SELF_HARM_SUPPORT"]] = []


def normalized(text: str) -> str:
    return " ".join(re.findall(r"\w+", unicodedata.normalize("NFKC", text or "").casefold()))


def _resolve_country(country_or_code, kb=None):
    if hasattr(country_or_code, "resources") and hasattr(country_or_code, "manifest"):
        return country_or_code
    loader = kb or CountryKBLoader(ROOT / "kb")
    return loader.load(str(country_or_code).upper())


def phrase_matches(raw_text_folded: str, normalized_padded: str, phrase: str) -> bool:
    candidate = unicodedata.normalize("NFKC", phrase or "").strip().casefold()
    if not candidate:
        return False
    if CJK_CHAR_RE.search(candidate):
        return candidate in raw_text_folded
    norm_phrase = normalized(candidate)
    return bool(norm_phrase and f" {norm_phrase} " in normalized_padded)


def screen(
    country_or_code,
    text: str,
    *,
    kb=None,
    strict: bool = True,
) -> SafetyResult:
    """Evaluate text against the country's KB red flags.

    Negation is intentionally not stripped: a phrase match inside a negated sentence still triggers
    a deterministic safety hit. Unmatched text is never medical clearance (`screening_complete=False`).
    """
    country = _resolve_country(country_or_code, kb=kb)
    resource = country.resources.red_flags

    if strict and (not resource.data or not checked_official(country, resource)):
        raise AppError(
            503,
            "TRIAGE_UNAVAILABLE",
            "Pemeriksaan tanda bahaya belum tersedia. Jawaban polis dan perbandingan "
            "dihentikan. Periksa layanan darurat setempat bila membutuhkan bantuan segera.",
        )

    raw_folded = unicodedata.normalize("NFKC", text or "").casefold()
    padded = f" {normalized(text or '')} "
    matched: list[TriageMatch] = []

    if resource.verification_status != VerificationStatus.VERIFIED:
        if strict:
            raise AppError(503, "TRIAGE_UNAVAILABLE", "Konfigurasi arahan darurat belum lengkap.")
        return SafetyResult(category="NONE_DETECTED", matched_flag_ids=[])

    for flag in resource.data:
        all_phrases = [
            p
            for p in (*flag.phrases_id, *flag.phrases_en, *flag.phrases_zh)
            if p and (CJK_CHAR_RE.search(p) or normalized(p))
        ]
        if strict:
            if not all_phrases or flag.destination_code not in VALID_DESTINATION_CODES:
                raise AppError(
                    503, "TRIAGE_UNAVAILABLE", "Konfigurasi arahan darurat belum lengkap."
                )
            if flag.source_url and not checked_official(country, flag):
                raise AppError(
                    503, "TRIAGE_UNAVAILABLE", "Konfigurasi arahan darurat belum lengkap."
                )
        else:
            if (
                flag.verification_status != VerificationStatus.VERIFIED
                or not (flag.source_url or resource.source_url)
                or not all_phrases
            ):
                continue

        if any(phrase_matches(raw_folded, padded, phrase) for phrase in all_phrases):
            matched.append(
                TriageMatch(
                    id=flag.id,
                    kb_version=resource.version,
                    category=flag.category,
                    source_url=flag.source_url or resource.source_url,
                )
            )

    flows: list[Literal["EMERGENCY_MEDICAL", "SELF_HARM_SUPPORT"]] = []
    if any(item.category == "MEDICAL" for item in matched):
        flows.append("EMERGENCY_MEDICAL")
    if any(item.category == "SELF_HARM" for item in matched):
        flows.append("SELF_HARM_SUPPORT")

    if "EMERGENCY_MEDICAL" in flows:
        category: Literal["MEDICAL_EMERGENCY", "SELF_HARM_RISK", "NONE_DETECTED"] = (
            "MEDICAL_EMERGENCY"
        )
    elif "SELF_HARM_SUPPORT" in flows:
        category = "SELF_HARM_RISK"
    else:
        category = "NONE_DETECTED"

    return SafetyResult(
        category=category,
        matched_flag_ids=[m.id for m in matched],
        screening_complete=False,
        red_flag=bool(matched),
        matched=matched,
        safety_flows=flows,
    )


def to_triage_result(result: SafetyResult) -> TriageResult:
    return TriageResult(
        red_flag=result.red_flag,
        matched=result.matched,
        safety_flows=result.safety_flows,
        screening_complete=False,
    )


def get_verified_emergency_contacts(country_or_code, *, kb=None) -> dict:
    """Return only KB-backed emergency contacts with explicit verification status.

    Never returns hardcoded or unsourced fallback numbers.
    """
    country = _resolve_country(country_or_code, kb=kb)
    code = country.manifest.country_code
    resource = country.resources.emergency
    config = resource.data

    resource_verified = checked_official(country, resource) and checked_official(country, config)
    contacts = []
    if resource_verified:
        for contact in config.contacts:
            if contact.verification_status == VerificationStatus.VERIFIED and checked_official(
                country, contact
            ):
                contacts.append(
                    {
                        "service_code": contact.service_code,
                        "label": contact.label,
                        "phone_number": contact.phone_number,
                        "jurisdiction": contact.jurisdiction,
                        "source_url": contact.source_url,
                        "checked_at": contact.checked_at.isoformat()
                        if contact.checked_at
                        else None,
                        "verification_status": contact.verification_status.value,
                        "verified": True,
                    }
                )

    primary_number = config.phone_number if (resource_verified and config.phone_number) else None
    return {
        "country_code": code,
        "available": bool(primary_number and contacts),
        "primary_emergency_number": primary_number,
        "contacts": contacts,
        "mental_health_crisis_line": None,
        "source_reference": config.source_url if resource_verified else None,
        "disclaimer": (
            "INSURRA provides direct emergency phone connections for safety only. Emergency "
            "guidance does not evaluate claim eligibility, require upfront policy verification, "
            "or constitute medical diagnosis."
        ),
    }
