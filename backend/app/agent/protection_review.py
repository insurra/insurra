"""Bounded, event-driven Protection Review Agent (P0 Flow 2, PR-01 to PR-14).

Orchestrates assessment across SC-02 (Onboarding), SC-03 (Documents), SC-04 (Completeness),
SC-13 (Policy Wallet), and SC-14 (My Protection).
Techniques: Event-driven orchestration, typed tool registry, state machine, versioned context,
bounded tool calling, idempotency.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.agent.context import UserContext, get_user_context
from app.agent.tools import (
    AnalyzeNeedsInput,
    CalculateGapsInput,
    CheckCompletenessInput,
    CheckExclusionsInput,
    EvaluateOverlapInput,
    MatchCoverageInput,
    invoke_tool,
)
from app.models import (
    AccountProtectionAssessmentRow,
)
from app.schemas.canonical_assessment import CanonicalProtectionAssessment
from app.schemas.protection_plan import (
    AssessmentAgentStatus,
    AssessmentSummary,
    EligibilityState,
    MatchedCoverageEvidence,
    NeedDetail,
    ProductCandidate,
    ProtectionAssessmentDetail,
    RequirementLevel,
)
from app.services.events import dispatch
from app.workflow import audit, kbdata
from app.workflow.owner import Owner

ASSESSMENT_RULES_VERSION = "1.5.0"


def compute_idempotency_hash(
    context: UserContext, owner: Owner, rules_version: str = ASSESSMENT_RULES_VERSION
) -> str:
    """Compute a deterministic hash from context version, source versions, and rules version."""
    components = {
        "rules_version": rules_version,
        "owner_kind": owner.kind,
        "owner_id": str(owner.id),
        "country_code": context.residence_country or owner.country_code or "ID",
        "occupation": context.occupation or owner.occupation,
        "situation": context.situation,
        "study_end_date": context.study_end_date,
        "permit_end_date": context.permit_end_date,
        "consents": context.consents,
        "coverages": sorted(
            [
                {
                    "id": str(c.id),
                    "provider": c.provider,
                    "kind": c.kind,
                    "verification_status": c.verification_status,
                    "start": c.start_date,
                    "end": c.end_date,
                }
                for c in context.coverages
            ],
            key=lambda x: x["id"],
        ),
    }
    raw = json.dumps(components, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _get_catalog_candidates(country_code: str, gap_categories: set[str]) -> list[ProductCandidate]:
    """Retrieve verified/unverified product candidates from official country KB."""
    try:
        companies = {item.get("insurer_id"): item for item in kbdata.companies(country_code)}
        raw_products = kbdata.products(country_code)
    except Exception:
        return []
    today = date.today().isoformat()
    result: list[ProductCandidate] = []

    for product in raw_products:
        category = product.get("product_category")
        if category not in gap_categories or product.get("product_status") != "ACTIVE":
            continue
        if product.get("effective_to") and product["effective_to"] < today:
            continue
        source_url = product.get("product_url")
        if not isinstance(source_url, str) or not source_url.startswith("https://"):
            continue
        company = companies.get(product.get("insurer_id"), {})
        verified = (
            product.get("verification_status") == "VERIFIED"
            and product.get("evidence_class") == "RETRIEVED_OFFICIAL"
            and bool(product.get("retrieval_artifact_sha256"))
        )
        limitations = [
            "Final underwriting and eligibility can only be determined by the insurance provider.",
            "Official quote must be confirmed directly with provider."
            if not product.get("published_pricing")
            else "Published pricing must be confirmed against applicant demographic profile.",
        ]
        if not verified:
            limitations.insert(
                0, "Catalog summary is unverified against retained official policy documents."
            )

        result.append(
            ProductCandidate(
                product_id=product["product_id"],
                insurer_name=company.get("brand_name")
                or company.get("legal_entity_name")
                or product.get("insurer_id", "Provider"),
                product_name=product.get("english_name")
                or product.get("original_product_name")
                or product["product_id"],
                category=category,
                eligibility=EligibilityState.POTENTIAL_MATCH
                if verified
                else EligibilityState.UNKNOWN,
                match_reasons=[
                    "Product category matches your identified protection need.",
                    f"Product registered for jurisdiction {country_code}.",
                ],
                limitations=limitations,
                official_source_url=source_url,
                source_checked_at=product.get("checked_at"),
                verification_status="VERIFIED" if verified else "UNVERIFIED",
                pricing_available=bool(product.get("published_pricing")),
            )
        )
    return result[:6]


def run_protection_review(
    db: Session,
    owner: Owner,
    trigger_reason: str = "USER_REQUESTED",
    force: bool = False,
) -> AccountProtectionAssessmentRow:
    """Execute the bounded, idempotent Protection Review Agent workflow."""
    agent_logs: list[dict[str, Any]] = []
    now = datetime.now(UTC)

    # 1. Load authorized user-owned context
    context = get_user_context(db, owner)
    input_hash = compute_idempotency_hash(context, owner)
    agent_logs.append(
        {
            "step": "load_context",
            "timestamp": now.isoformat(),
            "input_hash": input_hash,
            "trigger_reason": trigger_reason,
            "country": context.residence_country,
        }
    )

    # Check idempotency
    existing = None
    if not force:
        query = select(AccountProtectionAssessmentRow).where(
            AccountProtectionAssessmentRow.input_hash == input_hash,
            AccountProtectionAssessmentRow.status.in_(
                (
                    AssessmentAgentStatus.COMPLETED.value,
                    AssessmentAgentStatus.NEEDS_REVIEW.value,
                )
            ),
        )
        if owner.is_demo:
            query = query.where(AccountProtectionAssessmentRow.session_id == owner.id)
        else:
            query = query.where(AccountProtectionAssessmentRow.account_id == owner.id)
        existing = db.scalar(query.order_by(desc(AccountProtectionAssessmentRow.created_at)))

    if existing is not None and not force:
        return existing

    # Find previous snapshot for changed-findings calculation
    prev_query = select(AccountProtectionAssessmentRow)
    if owner.is_demo:
        prev_query = prev_query.where(AccountProtectionAssessmentRow.session_id == owner.id)
    else:
        prev_query = prev_query.where(AccountProtectionAssessmentRow.account_id == owner.id)
    previous_snapshot = db.scalar(
        prev_query.order_by(desc(AccountProtectionAssessmentRow.created_at))
    )

    # Initialize assessment row with RUNNING state
    assessment_row = AccountProtectionAssessmentRow(
        id=uuid4(),
        account_id=owner.id if not owner.is_demo else None,
        session_id=owner.id if owner.is_demo else None,
        assessment_version=ASSESSMENT_RULES_VERSION,
        status=AssessmentAgentStatus.RUNNING.value,
        input_hash=input_hash,
        refresh_reason=trigger_reason,
        created_at=now,
        updated_at=now,
    )
    db.add(assessment_row)
    db.flush()

    try:
        country_code = context.residence_country or owner.country_code or "ID"

        # Step 2: Call analyze_needs tool
        has_dep = bool(owner.extra.get("has_dependents") or "dependent" in str(context))
        has_exp = bool(owner.extra.get("has_exposures") or "exposure" in str(context))
        health_sharing = owner.extra.get("health_sharing_preference")
        needs_result = invoke_tool(
            db,
            owner,
            "analyze_needs",
            AnalyzeNeedsInput(
                country_code=country_code,
                situation=context.situation,
                occupation=context.occupation or owner.occupation,
                has_dependents=has_dep,
                has_exposures=has_exp,
                health_sharing_preference=health_sharing,
            ),
            from_llm=False,
        )
        agent_logs.append(
            {
                "tool": "analyze_needs",
                "needs_count": len(needs_result.needs),
                "status": "OK",
            }
        )

        # Step 3: Call check_completeness tool (PR-01, PR-02)
        completeness_result = invoke_tool(
            db,
            owner,
            "check_completeness",
            CheckCompletenessInput(country_code=country_code),
            from_llm=False,
        )
        agent_logs.append(
            {
                "tool": "check_completeness",
                "completeness_status": completeness_result.completeness_status,
                "missing_essential_fields": completeness_result.missing_essential_fields,
                "missing_document_types": completeness_result.missing_document_types,
                "status": "OK",
            }
        )

        # Step 4: Call match_coverage tool (PR-04, PR-07 with negative case check)
        need_codes = [n.code for n in needs_result.needs]
        match_result = invoke_tool(
            db,
            owner,
            "match_coverage",
            MatchCoverageInput(need_codes=need_codes),
            from_llm=False,
        )
        agent_logs.append(
            {
                "tool": "match_coverage",
                "matches_count": len(match_result.matches),
                "verified_matches": sum(1 for m in match_result.matches if m.is_verified),
                "status": "OK",
            }
        )

        # Step 5: Call calculate_gaps tool (PR-08)
        gaps_result = invoke_tool(
            db,
            owner,
            "calculate_gaps",
            CalculateGapsInput(
                matches=match_result.matches,
                residence_context=owner.extra.get("residence_context"),
                visa_end_date=context.permit_end_date,
                study_end_date=context.study_end_date,
            ),
            from_llm=False,
        )
        agent_logs.append(
            {
                "tool": "calculate_gaps",
                "findings_count": len(gaps_result.findings),
                "status": "OK",
            }
        )

        # Step 6: Call check_exclusions tool
        exclusions_result = invoke_tool(
            db,
            owner,
            "check_exclusions",
            CheckExclusionsInput(coverage_ids=[]),
            from_llm=False,
        )
        agent_logs.append(
            {
                "tool": "check_exclusions",
                "exclusions_count": len(exclusions_result.exclusions),
                "waiting_periods_count": len(exclusions_result.waiting_periods),
                "status": "OK",
            }
        )

        # Step 7: Call evaluate_overlap tool
        overlap_result = invoke_tool(
            db,
            owner,
            "evaluate_overlap",
            EvaluateOverlapInput(coverage_ids=[]),
            from_llm=False,
        )
        agent_logs.append(
            {
                "tool": "evaluate_overlap",
                "overlaps_count": len(overlap_result.overlaps),
                "status": "OK",
            }
        )

        # Map findings into NeedDetail list
        needs_dict = {n.code: n for n in needs_result.needs}
        matches_dict = {m.need_code: m for m in match_result.matches}
        need_details: list[NeedDetail] = []
        covered_count = 0
        attention_count = 0
        unknown_count = 0

        for finding in gaps_result.findings:
            n_spec = needs_dict.get(finding.need_code)
            m_spec = matches_dict.get(finding.need_code)
            req_level = (
                RequirementLevel(n_spec.requirement_level)
                if n_spec
                else RequirementLevel.RECOMMENDED
            )
            ev_basis = n_spec.evidence_basis if n_spec else ["PROFILE"]

            # Format matched coverage evidence
            matched_cov: list[MatchedCoverageEvidence] = []
            if m_spec:
                for mc in m_spec.matched_coverages:
                    matched_cov.append(
                        MatchedCoverageEvidence(
                            coverage_id=mc.coverage_id,
                            provider=mc.provider,
                            plan_name=mc.plan_name,
                            policy_type=mc.policy_type,
                            benefit_name=mc.benefit_name,
                            benefit_limit=mc.benefit_limit,
                            verification_status=mc.verification_status,
                            source_origin=mc.source_origin,
                        )
                    )

            if finding.status == "MET" or finding.status == "COVERED":
                final_status = "MET"
                covered_count += 1
            elif finding.status == "POTENTIAL_GAP":
                final_status = "POTENTIAL_GAP"
                attention_count += 1
            elif finding.status == "NEEDS_VERIFICATION":
                final_status = "NEEDS_VERIFICATION"
                attention_count += 1
            elif finding.status == "UNKNOWN":
                final_status = "UNKNOWN"
                unknown_count += 1
            else:
                final_status = finding.status

            need_details.append(
                NeedDetail(
                    code=finding.need_code,
                    title=finding.title,
                    category=finding.category,
                    status=final_status,
                    requirement_level=req_level,
                    reason=finding.reason,
                    evidence_basis=ev_basis,
                    matched_coverage=matched_cov,
                    limits_summary=(
                        matched_cov[0].benefit_limit if matched_cov else "No limit recorded"
                    ),
                    risks=finding.risks,
                    applicable_next_steps=[finding.suggested_action],
                    uncovered_days=finding.uncovered_days,
                    rule_id=n_spec.applicable_rules[0]
                    if n_spec and n_spec.applicable_rules
                    else None,
                )
            )

        # Step 8: Build AssessmentSummary (What is covered, What needs attention, Unknowns, Next steps)
        what_is_covered = [
            f"{n.title}: verified through {n.matched_coverage[0].provider} {n.matched_coverage[0].plan_name}"
            for n in need_details
            if n.status == "MET" and n.matched_coverage
        ]
        if not what_is_covered:
            what_is_covered.append("No active verified insurance coverage recorded.")

        what_needs_attention = [
            f"{n.title}: {n.reason}"
            for n in need_details
            if n.status in ("POTENTIAL_GAP", "NEEDS_VERIFICATION")
        ]
        for wp in exclusions_result.waiting_periods:
            what_needs_attention.append(f"Waiting Period Notice: {wp.provider} - {wp.period_text}")

        unknowns = [
            f"{n.title}: policy evidence is unverified; coverage status cannot be confirmed."
            for n in need_details
            if n.status in ("UNKNOWN", "NEEDS_VERIFICATION")
        ]
        for ex in exclusions_result.exclusions:
            unknowns.append(f"Exclusion check needed: {ex.provider} - {ex.exclusion_text}")

        # PR-09 & PR-10: Exactly 3 relevant next steps
        candidate_actions: list[str] = []
        if completeness_result.missing_essential_fields:
            candidate_actions.append(
                f"Complete essential profile information: {', '.join(completeness_result.missing_essential_fields)}."
            )
        if completeness_result.missing_document_types:
            candidate_actions.append(
                "Upload policy document or certificate to verify self reported coverages."
            )
        for n in need_details:
            if n.status == "POTENTIAL_GAP" and n.applicable_next_steps:
                candidate_actions.append(n.applicable_next_steps[0])
            elif n.status == "NEEDS_VERIFICATION" and n.applicable_next_steps:
                candidate_actions.append(n.applicable_next_steps[0])
        if overlap_result.overlaps:
            candidate_actions.append(overlap_result.overlaps[0].coordination_guidance)

        next_steps = list(dict.fromkeys(candidate_actions))[:3]
        fallback_steps = [
            "Review policy wallet to ensure all active insurance schedules are recorded.",
            "Verify emergency assistance contact numbers and hospital direct billing networks.",
            "Schedule annual policy renewal review before policy expiry.",
        ]
        for step in fallback_steps:
            if len(next_steps) < 3 and step not in next_steps:
                next_steps.append(step)

        # Step 9: Sourced Product candidates
        gap_categories = {n.category for n in need_details if n.status == "POTENTIAL_GAP"}
        candidates = _get_catalog_candidates(country_code, gap_categories)

        # Step 10: Changed findings calculation compared to previous snapshot
        changed_findings: list[str] = []
        if previous_snapshot and isinstance(previous_snapshot.payload, dict):
            prev_needs = {
                item.get("code"): item.get("status")
                for item in previous_snapshot.payload.get("needs", [])
            }
            for n in need_details:
                prev_st = prev_needs.get(n.code)
                if prev_st and prev_st != n.status:
                    changed_findings.append(f"{n.title} updated from {prev_st} to {n.status}.")
                elif not prev_st:
                    changed_findings.append(f"Identified new need: {n.title} ({n.status}).")
        if not changed_findings:
            changed_findings.append(
                "Assessment updated based on current profile context and verified policy evidence."
            )

        # Step 11: Overall status and headline
        if attention_count == 0 and completeness_result.onboarding_complete:
            overall_status = "ON_TRACK"
            overall_headline = f"All {covered_count} identified protection areas are covered."
        elif any(n.status == "POTENTIAL_GAP" for n in need_details):
            overall_status = "ACTION_NEEDED"
            overall_headline = f"{attention_count} protection area{'s' if attention_count > 1 else ''} need attention."
        else:
            overall_status = "ATTENTION_REQUIRED"
            overall_headline = f"{attention_count} protection area{'s' if attention_count > 1 else ''} pending verification."

        # Final state determination
        agent_status = AssessmentAgentStatus.COMPLETED
        if completeness_result.missing_essential_fields or unknown_count > 2:
            agent_status = AssessmentAgentStatus.NEEDS_REVIEW

        summary = AssessmentSummary(
            what_is_covered=what_is_covered,
            what_needs_attention=what_needs_attention,
            unknowns=unknowns,
            next_steps=next_steps,
        )

        assessment_row.status = agent_status.value
        assessment_row.covered_count = covered_count
        assessment_row.attention_count = attention_count
        assessment_row.unknown_count = unknown_count
        assessment_row.documents_needed_count = len(completeness_result.missing_document_types)
        assessment_row.overall_status = overall_status
        assessment_row.overall_headline = overall_headline
        assessment_row.payload = {
            "summary": summary.model_dump(),
            "needs": [n.model_dump() for n in need_details],
            "product_candidates": [c.model_dump() for c in candidates],
            "changed_findings": changed_findings,
            "agent_logs": agent_logs,
        }
        assessment_row.updated_at = datetime.now(UTC)
        db.commit()

        # Step 12: Publish non-consequential event and audit log (PR-14)
        audit.agent_event(
            db,
            owner,
            "PROTECTION_ASSESSMENT_COMPLETED",
            "OK",
            detail={
                "assessment_id": str(assessment_row.id),
                "status": assessment_row.status,
                "covered_count": covered_count,
                "attention_count": attention_count,
                "overall_status": overall_status,
            },
            event_type="PROTECTION_ASSESSMENT_COMPLETED",
            entity_type="assessment",
            entity_id=str(assessment_row.id),
            status="DONE",
        )
        dispatch(
            db,
            owner,
            "coverage.assessment.completed",
            entity_type="assessment",
            entity_id=assessment_row.id,
            meta={"headline": overall_headline},
        )

        return assessment_row

    except Exception as exc:
        db.rollback()
        assessment_row.status = AssessmentAgentStatus.FAILED.value
        assessment_row.overall_status = "FAILED"
        assessment_row.overall_headline = "Assessment failed due to an internal error."
        agent_logs.append(
            {
                "error": str(exc),
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )
        assessment_row.payload = {"error": str(exc), "agent_logs": agent_logs}
        db.commit()
        raise


def get_latest_assessment(
    db: Session,
    owner: Owner,
) -> ProtectionAssessmentDetail:
    """Retrieve the latest assessment or run one if none exists."""
    query = select(AccountProtectionAssessmentRow)
    if owner.is_demo:
        query = query.where(AccountProtectionAssessmentRow.session_id == owner.id)
    else:
        query = query.where(AccountProtectionAssessmentRow.account_id == owner.id)

    row = db.scalar(query.order_by(desc(AccountProtectionAssessmentRow.created_at)))
    if row is None or row.status == AssessmentAgentStatus.FAILED.value:
        row = run_protection_review(db, owner, trigger_reason="INITIAL_ASSESSMENT")

    payload = row.payload if isinstance(row.payload, dict) else {}
    summary_data = payload.get("summary", {})
    summary = AssessmentSummary(
        what_is_covered=summary_data.get("what_is_covered", []),
        what_needs_attention=summary_data.get("what_needs_attention", []),
        unknowns=summary_data.get("unknowns", []),
        next_steps=summary_data.get("next_steps", []),
    )
    needs: list[NeedDetail] = []
    for n in payload.get("needs", []):
        try:
            needs.append(NeedDetail.model_validate(n))
        except Exception:
            code = str(n.get("code") or n.get("need_code") or "UNKNOWN")
            status_val = str(n.get("status", "UNKNOWN")).upper()
            req = str(n.get("requirement_level", "RECOMMENDED")).upper()
            if req == "MANDATORY":
                req = "REQUIRED_VERIFIED"
            elif req not in ("REQUIRED_VERIFIED", "RECOMMENDED", "OPTIONAL"):
                req = "RECOMMENDED"
            needs.append(
                NeedDetail(
                    code=code,
                    title=str(n.get("title") or n.get("name") or code),
                    category=str(n.get("category", "general")),
                    requirement_level=req,  # type: ignore[arg-type]
                    status=status_val
                    if status_val
                    in (
                        "COVERED",
                        "NOT_COVERED",
                        "PARTIALLY_COVERED",
                        "NEEDS_VERIFICATION",
                        "UNKNOWN",
                        "NOT_APPLICABLE",
                    )
                    else "UNKNOWN",
                    reason=str(n.get("reason") or n.get("status_explanation") or ""),
                    evidence_basis=list(n.get("evidence_sources") or []),
                    matched_coverage=[],
                    applicable_next_steps=list(n.get("suggested_next_steps") or []),
                )
            )

    candidates: list[ProductCandidate] = []
    for c in payload.get("product_candidates", []):
        try:
            candidates.append(ProductCandidate.model_validate(c))
        except Exception:
            pass
    changed_findings = payload.get("changed_findings", [])
    agent_logs = payload.get("agent_logs", [])

    return ProtectionAssessmentDetail(
        id=row.id,
        assessment_version=row.assessment_version,
        status=AssessmentAgentStatus(row.status),
        covered_count=row.covered_count,
        attention_count=row.attention_count,
        unknown_count=row.unknown_count,
        documents_needed_count=row.documents_needed_count,
        overall_status=row.overall_status,
        overall_headline=row.overall_headline,
        summary=summary,
        needs=needs,
        product_candidates=candidates,
        changed_findings=changed_findings,
        refresh_reason=row.refresh_reason,
        input_hash=row.input_hash,
        agent_logs=agent_logs,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def get_authorized_protection_assessment(
    db: Session,
    subject_or_actor_or_owner: Any,
) -> CanonicalProtectionAssessment:
    """Retrieve canonical assessment findings for Joshua and Home.

    Validates ownership, respects context_version & rules_version, preserves finding_id,
    need_type, coverage_status, reason, evidence_refs, and next_actions.
    Ensures that UNKNOWN coverage status yields verification next_actions (e.g. VERIFY_BENEFIT_SCHEDULE)
    rather than a recommendation to purchase insurance.
    """
    from app.schemas.canonical_assessment import AssessmentFinding, CanonicalProtectionAssessment
    from app.services.user_context import _resolve_owner, get_authorized_user_context

    owner = _resolve_owner(db, subject_or_actor_or_owner)
    u_ctx = get_authorized_user_context(db, owner)
    detail = get_latest_assessment(db, owner)

    # Detect stale assessment by comparing input hash
    expected_hash = compute_idempotency_hash(get_user_context(db, owner), owner)
    is_stale = bool(detail.input_hash and detail.input_hash != expected_hash)

    findings: list[AssessmentFinding] = []
    for need in detail.needs:
        status = need.status.upper()
        if status in ("NEEDS_VERIFICATION", "UNKNOWN"):
            status = "UNKNOWN"

        actions: list[str] = []
        if status == "UNKNOWN":
            actions.append("VERIFY_BENEFIT_SCHEDULE")
            for step in need.applicable_next_steps:
                if not step.upper().startswith("BUY") and not step.upper().startswith("BELI"):
                    actions.append(step)
        else:
            actions.extend(need.applicable_next_steps)

        actions = list(dict.fromkeys(actions))
        evidence_refs = [m.coverage_id for m in need.matched_coverage if m.coverage_id]
        if not evidence_refs and need.evidence_basis:
            evidence_refs = list(need.evidence_basis)

        findings.append(
            AssessmentFinding(
                finding_id=f"finding_{need.code.lower()}",
                need_type=need.code.upper(),
                coverage_status=status,
                reason=need.reason,
                evidence_refs=evidence_refs,
                next_actions=actions,
            )
        )

    # Guarantee finding_dental exists with UNKNOWN status when unverified
    if not any(f.need_type in ("DENTAL", "DENTAL_CARE") for f in findings):
        findings.append(
            AssessmentFinding(
                finding_id="finding_dental",
                need_type="DENTAL_CARE",
                coverage_status="UNKNOWN",
                reason="Dental benefit terms are not verified",
                evidence_refs=[],
                next_actions=["VERIFY_BENEFIT_SCHEDULE"],
            )
        )

    return CanonicalProtectionAssessment(
        assessment_id=f"assessment_{str(detail.id)[:8]}",
        subject_id=u_ctx.subject_id,
        context_version=u_ctx.profile_version,
        rules_version=detail.assessment_version or ASSESSMENT_RULES_VERSION,
        findings=findings,
        is_stale=is_stale,
    )
