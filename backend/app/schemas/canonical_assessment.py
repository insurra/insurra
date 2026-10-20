"""Canonical Protection Assessment Findings Contract (Section 4 Integration Requirements).

Supports the exact structured findings contract consumed by Joshua and Home:
- assessment_id, subject_id, context_version, rules_version
- findings with finding_id, need_type, coverage_status, reason, evidence_refs, next_actions
"""

from __future__ import annotations

from typing import Any

from pydantic import Field

from app.schemas.common import Contract


class AssessmentFinding(Contract):
    finding_id: str
    need_type: str
    coverage_status: str
    reason: str
    evidence_refs: list[str | dict[str, Any]] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)


class CanonicalProtectionAssessment(Contract):
    assessment_id: str
    subject_id: str
    context_version: int | str = 1
    rules_version: str = "1.5.0"
    findings: list[AssessmentFinding] = Field(default_factory=list)
    is_stale: bool = False
