"""Shared Policy Wallet & Policy Intelligence Service (Section 3 Integration Requirements).

Provides:
- Unified policy reader for both demo sessions and authenticated accounts
- Policy applicability validation (person, country, treatment, date)
- Preservation of limits, deductibles, copays, exclusions, waiting periods, clauses
- Strict evidence status distinction (VERIFIED vs EXTRACTED vs SELF_REPORTED vs UNKNOWN)
"""

from __future__ import annotations

from dataclasses import field
from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import (
    AccountCoverageRow,
    AccountDocumentPageRow,
    InsuranceRecordRow,
)
from app.schemas.common import Contract
from app.workflow.owner import Owner


class ClauseReference(Contract):
    document_id: str | None = None
    filename: str | None = None
    page: int | None = None
    section: str | None = None
    clause_text: str | None = None
    verification_status: str = "UNVERIFIED"


class PolicyApplicabilityResult(Contract):
    policy_id: str
    applies: bool
    reason: str
    effective_start: str | None = None
    effective_end: str | None = None
    covered_persons: list[str] = field(default_factory=list)
    country_applicable: bool = True
    treatment_covered: str = "UNKNOWN"  # "COVERED", "EXCLUDED", "UNKNOWN", "WAITING_PERIOD"
    benefit_limit: str | None = None
    deductible: str | None = None
    copay: str | None = None
    exclusions: list[str] = field(default_factory=list)
    waiting_periods: list[str] = field(default_factory=list)
    clauses: list[ClauseReference] = field(default_factory=list)
    verification_status: str = "UNVERIFIED"


def get_shared_policy_record(db: Session, owner: Owner, policy_id: str | UUID) -> dict[str, Any]:
    """Retrieve canonical policy record and metadata for demo session or authenticated account."""
    pid_str = str(policy_id)
    if owner.is_demo:
        rec = db.scalar(select(InsuranceRecordRow).where(InsuranceRecordRow.session_id == owner.id))
        if rec is None or not isinstance(rec.payload, dict):
            raise AppError(404, "POLICY_NOT_FOUND", "No policy records found for session.")
        policies = rec.payload.get("policies", [])
        for p in policies:
            if str(p.get("id")) == pid_str:
                return {
                    "id": pid_str,
                    "provider": p.get("provider_name"),
                    "plan_name": p.get("policy_name"),
                    "policy_number": p.get("policy_number_masked"),
                    "policy_type": p.get("policy_type", "OTHER"),
                    "country_code": rec.payload.get("country_code", "ID"),
                    "start_date": p.get("coverage_start_date"),
                    "end_date": p.get("coverage_end_date"),
                    "coverage_limit": p.get("coverage_limit"),
                    "deductible": p.get("deductible"),
                    "copay": p.get("copay"),
                    "benefits": p.get("benefits", []),
                    "exclusions": p.get("exclusions", []),
                    "waiting_periods": p.get("waiting_periods", []),
                    "covered_persons": p.get("covered_persons", [p.get("insured_name") or "Self"]),
                    "evidence_status": p.get("verification_status", "SYNTHETIC"),
                    "source_document_ids": [str(d) for d in p.get("source_document_ids", [])],
                }
        raise AppError(404, "POLICY_NOT_FOUND", f"Policy '{policy_id}' not found in demo session.")
    else:
        try:
            p_uuid = UUID(pid_str)
        except ValueError:
            raise AppError(404, "POLICY_NOT_FOUND", "Invalid policy UUID.") from None
        row = db.scalar(
            select(AccountCoverageRow).where(
                AccountCoverageRow.id == p_uuid,
                AccountCoverageRow.account_id == owner.id,
                AccountCoverageRow.archived.is_(False),
            )
        )
        if row is None:
            raise AppError(404, "POLICY_NOT_FOUND", f"Policy '{policy_id}' not found.")
        from app.models import AccountFieldRow

        fields = list(
            db.scalars(select(AccountFieldRow).where(AccountFieldRow.coverage_id == row.id))
        )
        benefits = []
        exclusions = []
        for f in fields:
            if f.field_key.startswith("benefit_"):
                benefits.append(
                    {"name": f.field_key[8:].replace("_", " ").title(), "limit": str(f.value)}
                )
            elif f.field_key.startswith("exclusion_"):
                exclusions.append(str(f.value))

        return {
            "id": str(row.id),
            "provider": row.provider,
            "plan_name": row.plan_name,
            "policy_number": row.policy_number_masked,
            "policy_type": row.kind,
            "country_code": row.country_code,
            "start_date": row.start_date,
            "end_date": row.end_date,
            "coverage_limit": row.coverage_limit,
            "deductible": row.deductible,
            "copay": getattr(row, "copay", None),
            "benefits": benefits,
            "exclusions": exclusions,
            "waiting_periods": [],
            "covered_persons": ["Self"],
            "evidence_status": row.evidence_status or "SELF_REPORTED",
            "source_document_ids": [str(row.document_id)] if row.document_id else [],
        }


def validate_policy_applicability(
    db: Session,
    owner: Owner,
    policy_id: str | UUID,
    *,
    target_person: str | None = None,
    target_country: str | None = None,
    treatment_type: str | None = None,
    target_date: date | None = None,
) -> PolicyApplicabilityResult:
    """Validate whether policy applies to the user, covered person, country, treatment, and relevant date.

    Preserves benefit limits, deductibles, copays, exclusions, and waiting periods.
    Never hallucinates coverage merely because a related term appears.
    """
    pol = get_shared_policy_record(db, owner, policy_id)

    # Date check
    date_ok = True
    date_reason = []
    if target_date:
        if pol.get("start_date"):
            try:
                s_date = date.fromisoformat(pol["start_date"])
                if target_date < s_date:
                    date_ok = False
                    date_reason.append(
                        f"Target date precedes policy start date ({pol['start_date']})"
                    )
            except ValueError:
                pass
        if pol.get("end_date"):
            try:
                e_date = date.fromisoformat(pol["end_date"])
                if target_date > e_date:
                    date_ok = False
                    date_reason.append(
                        f"Target date is after policy expiration date ({pol['end_date']})"
                    )
            except ValueError:
                pass

    # Country check
    country_ok = True
    if target_country and pol.get("country_code"):
        if pol["country_code"].upper() != target_country.upper():
            # If not matching country, check if international / worldwide
            pol_type = str(pol.get("policy_type", "")).casefold()
            plan_name = str(pol.get("plan_name", "")).casefold()
            if not any(
                k in f"{pol_type} {plan_name}"
                for k in ("worldwide", "international", "travel", "student")
            ):
                country_ok = False

    # Person check
    person_ok = True
    covered_persons = pol.get("covered_persons", [])
    if target_person and covered_persons:
        if not any(target_person.casefold() in cp.casefold() for cp in covered_persons):
            person_ok = False

    # Treatment check
    treatment_status = "UNKNOWN"
    treatment_reason = ""
    benefit_limit = None

    if treatment_type:
        tt_lower = treatment_type.casefold()
        benefits = pol.get("benefits", [])
        exclusions = pol.get("exclusions", [])

        # Check explicit exclusions first
        excluded = False
        for ex in exclusions:
            ex_text = str(ex).casefold()
            if tt_lower in ex_text:
                treatment_status = "EXCLUDED"
                treatment_reason = f"Explicitly excluded: {ex}"
                excluded = True
                break

        if not excluded:
            # Check benefits
            matched_b = None
            for b in benefits:
                b_name = (b.get("name") if isinstance(b, dict) else str(b)).casefold()
                if tt_lower in b_name or ("inpatient" in tt_lower and "hospital" in b_name):
                    matched_b = b
                    break
            if matched_b:
                if pol.get("evidence_status") in ("VERIFIED", "USER_CONFIRMED"):
                    treatment_status = "COVERED"
                    treatment_reason = "Benefit verified in policy schedule."
                else:
                    treatment_status = "UNKNOWN"
                    treatment_reason = (
                        "Benefit appears in unverified policy records; confirmation required."
                    )
                if isinstance(matched_b, dict):
                    benefit_limit = matched_b.get("limit")
            else:
                treatment_status = "UNKNOWN"
                treatment_reason = f"No verified benefit terms found for '{treatment_type}'."

    # Overall applicability
    applies = date_ok and country_ok and person_ok and treatment_status != "EXCLUDED"
    reasons = []
    if not date_ok:
        reasons.extend(date_reason)
    if not country_ok:
        reasons.append(
            f"Policy country ({pol.get('country_code')}) does not match target ({target_country})."
        )
    if not person_ok:
        reasons.append(f"Person '{target_person}' is not listed among covered persons.")
    if treatment_reason:
        reasons.append(treatment_reason)

    # Retrieve source clauses if available
    clauses: list[ClauseReference] = []
    doc_ids = pol.get("source_document_ids", [])
    if doc_ids and not owner.is_demo:
        try:
            doc_uuid = UUID(doc_ids[0])
            pages = list(
                db.scalars(
                    select(AccountDocumentPageRow)
                    .where(AccountDocumentPageRow.document_id == doc_uuid)
                    .order_by(AccountDocumentPageRow.page_no)
                    .limit(3)
                )
            )
            for p in pages:
                clauses.append(
                    ClauseReference(
                        document_id=str(doc_uuid),
                        page=p.page_no,
                        section="Policy Schedule",
                        clause_text=p.text[:200],
                        verification_status=pol.get("evidence_status", "UNVERIFIED"),
                    )
                )
        except Exception:
            pass

    return PolicyApplicabilityResult(
        policy_id=str(pol["id"]),
        applies=applies,
        reason="; ".join(reasons) if reasons else "Policy applies.",
        effective_start=pol.get("start_date"),
        effective_end=pol.get("end_date"),
        covered_persons=covered_persons,
        country_applicable=country_ok,
        treatment_covered=treatment_status,
        benefit_limit=benefit_limit or pol.get("coverage_limit"),
        deductible=pol.get("deductible"),
        copay=pol.get("copay"),
        exclusions=[str(e) for e in pol.get("exclusions", [])],
        waiting_periods=[str(w) for w in pol.get("waiting_periods", [])],
        clauses=clauses,
        verification_status=pol.get("evidence_status", "UNVERIFIED"),
    )
