"""Emergency guidance service (SC-08).

Delegates red-flag evaluation and emergency contact lookup to the shared KB-driven
`app.services.safety_screen` module. Contains zero hardcoded fallback phone numbers or
invented medical patterns.
"""

from __future__ import annotations

from app.services.safety_screen import (
    GUIDANCE_BY_CATEGORY,
    get_verified_emergency_contacts,
    screen,
)
from app.workflow import audit, kbdata


def get_emergency_contacts(country_code: str, *, kb=None) -> dict:
    code = kbdata.require_country(country_code)
    return get_verified_emergency_contacts(code, kb=kb)


def evaluate_triage(
    text: str,
    country_code: str,
    *,
    kb=None,
    db=None,
    owner=None,
) -> dict:
    code = kbdata.require_country(country_code)
    result = screen(code, text or "", kb=kb, strict=False)
    emergency_info = get_verified_emergency_contacts(code, kb=kb)

    matched_flags = [
        {
            "flag_id": m.id,
            "category": m.category,
            "guidance": GUIDANCE_BY_CATEGORY.get(
                m.category,
                "Critical safety red flag detected. Contact local emergency services immediately.",
            ),
            "source_url": m.source_url,
            "kb_version": m.kb_version,
        }
        for m in result.matched
    ]

    if result.red_flag and db is not None and owner is not None:
        audit.record(
            db,
            owner,
            event_type="GUARDRAIL_RED_FLAG",
            category="SECURITY",
            title="Emergency red-flag screening triggered",
            summary="Safety screen interrupted non-emergency flow based on KB red-flag match.",
            details={
                "country_code": code,
                "flag_category": result.category,
                "flag_ids": result.matched_flag_ids,
            },
        )
        db.commit()

    return {
        "has_red_flag": result.red_flag,
        "category": result.category,
        "matched_flag_ids": result.matched_flag_ids,
        "screening_complete": False,
        "country_code": code,
        "matched_flags": matched_flags,
        "safety_flows": list(result.safety_flows),
        "emergency_contacts": emergency_info["contacts"],
        "mental_health_crisis_line": emergency_info["mental_health_crisis_line"],
        "recommended_action": (
            "INTERRUPT_NON_EMERGENCY_FLOW" if result.red_flag else "CONTINUE_STANDARD_CARE_FLOW"
        ),
        "guidance_message": (
            GUIDANCE_BY_CATEGORY["MEDICAL"]
            if result.category == "MEDICAL_EMERGENCY"
            else GUIDANCE_BY_CATEGORY["SELF_HARM"]
            if result.category == "SELF_HARM_RISK"
            else "No immediate red flag expressions detected. Unmatched text is not medical clearance."
        ),
    }
