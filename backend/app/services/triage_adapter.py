"""Deterministic consumer of the shared KB-driven safety screen, no medical KB invented."""

from app.schemas.foundation import TriageResult
from app.services.safety_screen import normalized, screen, to_triage_result

__all__ = ["normalized", "triage_check"]


def triage_check(country, text: str) -> TriageResult:
    return to_triage_result(screen(country, text, strict=True))
