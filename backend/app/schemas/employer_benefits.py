"""Schemas for SC-15 Employer Benefits Intelligence & Coordination of Benefits."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import Contract


class BenefitItemSchema(Contract):
    benefit_category: str = Field(
        description="e.g. inpatient, outpatient, dental, optical, maternity, emergency, mental_health"
    )
    coverage_status: Literal["Covered", "Partial", "Not covered", "Unknown"] = "Covered"
    limit_amount: str | None = Field(
        default=None, description="Formatted limit string or 'As per plan'"
    )
    limit_numeric: float | None = Field(
        default=None, description="Deterministic numeric limit amount"
    )
    used_amount: str | None = Field(default=None, description="Formatted used amount if verified")
    used_numeric: float | None = Field(
        default=None, description="Deterministic numeric used amount if verified"
    )
    available_balance: str | None = Field(
        default=None, description="Formatted available balance if verified, else 'Unknown'"
    )
    available_numeric: float | None = Field(
        default=None, description="Deterministic remaining balance if verified"
    )
    details: str | None = Field(
        default=None, description="Specific terms, deductible, or network notes"
    )
    utilization_status: Literal["VERIFIED", "UNKNOWN"] = Field(
        default="UNKNOWN",
        description="Utilization is never fabricated; UNKNOWN unless actual claim usage data exists",
    )


class EmployerBenefitSaveRequest(Contract):
    company_name: str = Field(min_length=1, max_length=200)
    employment_status: str = Field(default="Full-time employee")
    employment_start_date: str | None = None
    employment_end_date: str | None = None
    plan_name: str = Field(min_length=1, max_length=200)
    insurer_name: str | None = None
    policy_number: str | None = None
    eligible_dependents: list[str] = Field(default_factory=list)
    claim_procedure_cashless: bool = True
    claim_procedure_reimbursement: bool = True
    source_document_id: UUID | None = None
    verification_status: Literal["VERIFIED", "UNVERIFIED", "SELF_REPORTED"] = "SELF_REPORTED"
    benefits: list[BenefitItemSchema] = Field(default_factory=list)


class BenefitOverlapItem(Contract):
    category: str
    employer_coverage: str
    public_coverage: str | None = None
    personal_coverage: str | None = None
    coordination_status: Literal[
        "PRIMARY", "SECONDARY", "SUPPLEMENTARY", "POTENTIAL_OVERLAP", "UNKNOWN"
    ] = "UNKNOWN"
    notes: str


class ContinuityIssue(Contract):
    issue_type: str
    severity: Literal["LOW", "MEDIUM", "HIGH"]
    description: str
    recommendation: str


class EmployerBenefitsOverviewResponse(Contract):
    id: UUID | None = None
    has_employer_coverage: bool = True
    company_name: str
    employment_status: str
    employment_period: str
    is_active: bool = True
    plan_name: str
    insurer_name: str | None = None
    policy_number: str | None = None
    coverage_period: str | None = None
    eligible_dependents: list[str] = Field(default_factory=list)
    coverage_score_percent: int = 80
    coverage_status_label: str = "Well covered"
    coverage_status_summary: str = "Your employer benefits provide comprehensive coverage. Some areas may still need attention."
    counts: dict[str, int] = Field(default_factory=dict)
    key_benefits: list[BenefitItemSchema] = Field(default_factory=list)
    claim_procedure: dict[str, str | bool] = Field(default_factory=dict)
    overlaps: list[BenefitOverlapItem] = Field(default_factory=list)
    continuity_issues: list[ContinuityIssue] = Field(default_factory=list)
    ai_guidance: list[str] = Field(default_factory=list)
    verification_status: str = "UNVERIFIED"
    has_custom_data: bool = False
    updated_at: datetime | None = None
