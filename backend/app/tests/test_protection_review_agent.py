"""Tests for Bounded, Event-Driven Protection Review Agent (P0 Flow 2, PR-01 to PR-14)."""

import hashlib
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.agent.protection_review import (
    ASSESSMENT_RULES_VERSION,
    run_protection_review,
)
from app.agent.tools import (
    AnalyzeNeedsInput,
    CalculateGapsInput,
    CheckCompletenessInput,
    MatchCoverageInput,
    invoke_tool,
)
from app.models import (
    AccountCoverageRow,
    AccountRow,
    AccountSessionRow,
)
from app.schemas.protection_plan import AssessmentAgentStatus
from app.tests.test_account_workspace import grant
from app.workflow.owner import ACCOUNT, Owner


def make_account_user(client):
    token = f"prot-agent-{uuid4().hex[:6]}"
    now = datetime.now(UTC)
    with client.app.state.session_factory() as db:
        acc = AccountRow(
            id=uuid4(),
            email=f"prot_{uuid4().hex[:6]}@example.test",
            display_name="Raka Agent User",
            email_verified=True,
            created_at=now,
            updated_at=now,
        )
        db.add(acc)
        db.add(
            AccountSessionRow(
                id=uuid4(),
                account_id=acc.id,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                created_at=now,
                expires_at=now + timedelta(hours=2),
            )
        )
        db.commit()
    headers = {"Authorization": f"Bearer {token}"}
    return acc.id, headers


def test_specialized_tools_direct_invocation(client):
    account_id, headers = make_account_user(client)
    owner = Owner(kind=ACCOUNT, id=account_id)

    with client.app.state.session_factory() as db:
        # 1. analyze_needs
        needs_res = invoke_tool(
            db,
            owner,
            "analyze_needs",
            AnalyzeNeedsInput(
                country_code="CN",
                situation="STUDENT",
                occupation="STUDENT",
                has_dependents=True,
                has_exposures=True,
                health_sharing_preference="SHARE_RELEVANT",
            ),
            from_llm=False,
        )
        codes = {n.code for n in needs_res.needs}
        assert "core_medical" in codes
        assert "student_requirement" in codes
        assert "dependent_protection" in codes
        assert "activity_exposure" in codes
        assert "health_preferences" in codes
        assert "emergency_assistance" in codes

        # 2. check_completeness
        comp_res = invoke_tool(
            db,
            owner,
            "check_completeness",
            CheckCompletenessInput(country_code="CN"),
            from_llm=False,
        )
        assert comp_res.completeness_status in ("PARTIAL", "INCOMPLETE")

        # 3. match_coverage (critical negative case: MSIG commercial liability)
        # Add an MSIG commercial liability policy
        cov = AccountCoverageRow(
            id=uuid4(),
            account_id=account_id,
            provider="MSIG",
            kind="commercial_liability",
            country_code="ID",
            policy_number_masked="MSIG-LIAB-***",
            start_date="2025-01-01",
            end_date="2025-12-31",
            created_at=datetime.now(UTC),
        )
        db.add(cov)
        db.commit()

        # match_coverage for core_medical MUST NOT match MSIG commercial liability!
        match_res = invoke_tool(
            db,
            owner,
            "match_coverage",
            MatchCoverageInput(need_codes=["core_medical"]),
            from_llm=False,
        )
        core_match = match_res.matches[0]
        assert core_match.is_verified is False
        assert len(core_match.matched_coverages) == 0
        assert core_match.status == "POTENTIAL_GAP"

        # 4. Critical requirement: unverified policy must be UNKNOWN or NEEDS_VERIFICATION, never NOT_COVERED
        cov_health = AccountCoverageRow(
            id=uuid4(),
            account_id=account_id,
            provider="Prudential",
            kind="health",
            country_code="ID",
            policy_number_masked="PRU-***",
            start_date="2025-01-01",
            end_date="2025-12-31",
            created_at=datetime.now(UTC),
        )
        db.add(cov_health)
        db.commit()

        match_health = invoke_tool(
            db,
            owner,
            "match_coverage",
            MatchCoverageInput(need_codes=["core_medical"]),
            from_llm=False,
        )
        health_match = match_health.matches[0]
        assert health_match.status in ("NEEDS_VERIFICATION", "UNKNOWN")
        assert health_match.status != "NOT_COVERED"

        # 5. calculate_gaps with continuity gap
        gaps_res = invoke_tool(
            db,
            owner,
            "calculate_gaps",
            CalculateGapsInput(
                matches=match_health.matches,
                visa_end_date="2026-06-30",
            ),
            from_llm=False,
        )
        assert len(gaps_res.findings) == 1
        finding = gaps_res.findings[0]
        assert finding.status in ("NEEDS_VERIFICATION", "POTENTIAL_GAP")
        assert finding.priority in ("NORMAL", "HIGH")


def test_protection_review_agent_idempotency_and_state_machine(client):
    account_id, headers = make_account_user(client)
    owner = Owner(kind=ACCOUNT, id=account_id, occupation="SOFTWARE_ENGINEER")

    with client.app.state.session_factory() as db:
        # Run 1: initial run with occupation provided completes
        run1 = run_protection_review(db, owner, trigger_reason="INITIAL_RUN", force=True)
        assert run1.status in (
            AssessmentAgentStatus.COMPLETED.value,
            AssessmentAgentStatus.NEEDS_REVIEW.value,
        )
        assert run1.assessment_version == ASSESSMENT_RULES_VERSION
        hash1 = run1.input_hash
        id1 = run1.id

        # Run 2: without force, returns existing snapshot with identical hash (Idempotency)
        run2 = run_protection_review(db, owner, trigger_reason="IDEMPOTENT_CHECK", force=False)
        assert run2.id == id1
        assert run2.input_hash == hash1

        # Run 3: with force=True, creates a refreshed snapshot
        run3 = run_protection_review(db, owner, trigger_reason="FORCE_REFRESH", force=True)
        assert run3.id != id1
        assert run3.status in (
            AssessmentAgentStatus.COMPLETED.value,
            AssessmentAgentStatus.NEEDS_REVIEW.value,
        )


def test_automatic_assessment_update_on_document_confirm(client):
    account_id, headers = make_account_user(client)
    grant(client, headers, "process_documents")
    grant(client, headers, "external_ai")
    grant(client, headers, "retention")

    # Set profile
    client.put(
        "/api/v1/account/profile",
        headers=headers,
        json={
            "display_name": "Raka Pratama",
            "residence_context": "ABROAD",
            "country_code": "CN",
            "occupation": "STUDENT",
            "city": "Beijing",
        },
    )

    # Seed sample documents
    seed_res = client.post("/api/v1/account/documents/seed", headers=headers)
    assert seed_res.status_code == 200
    docs = seed_res.json()
    aia_doc = next(d for d in docs if "AIA_Student_Policy" in d["original_filename"])
    doc_id = aia_doc["id"]

    # Before confirmation: check assessment
    res_before = client.get("/api/v1/protection-assessment", headers=headers)
    assert res_before.status_code == 200
    data_before = res_before.json()
    before_covered = data_before["covered_count"]

    # Confirm the document with verified benefits
    confirm_payload = {
        "document_kind": "policy_document",
        "status": "VERIFIED",
        "version_detected": "NEW_POLICY",
        "fields": {
            "provider": "AIA Group Limited",
            "plan_name": "AIA International Student Insurance Plan",
            "policy_number": "AIA-STU-2024-568923",
            "policyholder_name": "Raka Pratama",
            "insured_name": "Raka Pratama",
            "coverage_start_date": "2024-09-01",
            "coverage_end_date": "2025-08-31",
            "plan_type": "Comprehensive Plan (Standard)",
        },
        "benefits": [
            {"benefit_item": "Inpatient Medical Expenses", "limit": "RMB 1,000,000"},
            {"benefit_item": "Outpatient Medical Expenses", "limit": "RMB 200,000"},
        ],
        "exclusions": ["Pre-existing conditions not disclosed"],
        "waiting_periods": ["30 days waiting period for general illnesses"],
        "claim_conditions": ["Written notification within 30 days"],
    }
    confirm_res = client.post(
        f"/api/v1/account/documents/{doc_id}/confirm",
        headers=headers,
        json=confirm_payload,
    )
    assert confirm_res.status_code == 200

    # Verification: Uploading and verifying a new policy automatically updates the Protection Assessment!
    res_after = client.get("/api/v1/protection-assessment", headers=headers)
    assert res_after.status_code == 200
    data_after = res_after.json()
    assert data_after["status"] == "COMPLETED"
    assert data_after["covered_count"] >= 1
    assert data_after["covered_count"] > before_covered
    assert any("AIA" in item for item in data_after["summary"]["what_is_covered"])
    assert len(data_after["summary"]["next_steps"]) == 3


def test_api_run_protection_assessment_on_demand(client):
    account_id, headers = make_account_user(client)

    run_res = client.post(
        "/api/v1/protection-assessment/run",
        headers=headers,
        json={"force": True, "trigger_reason": "USER_CHECK_MY_PROTECTION"},
    )
    assert run_res.status_code == 200
    data = run_res.json()
    assert data["status"] in ("COMPLETED", "NEEDS_REVIEW")
    assert len(data["summary"]["next_steps"]) <= 3
    assert len(data["needs"]) >= 2
    assert "overall_headline" in data
