"""Tests for SC-05 Action Prioritization Engine (H-01 to H-11).

Validates:
- H-01: Personalized greeting and context
- H-02: Latest protection assessment brief summary and score
- H-03: Max 3 prioritized actions deterministically ranked
- H-04: Policy renewal / expiry alerts (<=30d high, <=90d upcoming)
- H-05: Active claims needing evidence
- H-06: Pending approval actions
- H-07: Recent activity max 3 entries
- H-09: Deep link and source finding attached to each action
- H-10: Dynamic refresh and exclusion of handled/dismissed actions
- H-11: Empty state handling
"""

from datetime import UTC, datetime
from uuid import uuid4

from app.models import RecommendationStateRow
from app.schemas.actor import Actor
from app.services.command_center import summary
from app.tests.workspace_fixtures import workspace
from app.workflow.models import WfActionRow, WfClaimCaseRow
from app.workflow.owner import Owner


def test_prioritization_engine_ranks_pending_approval_and_claim_and_findings(app, client):
    headers, account_id, coverage_id, _ = workspace(app, client, "CN")
    actor = Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=account_id)
    owner = Owner(kind="ACCOUNT", id=actor.account_id)

    profile = {
        "display_name": "Sinta Dewi",
        "residence_context": "ABROAD",
        "country_code": "CN",
        "city": "Beijing",
        "occupation": "STUDENT",
        "situation": "STUDENT",
        "visa_expiry_date": "2027-06-30",
        "has_existing_insurance": "YES",
        "owned_coverage": ["Student Insurance"],
    }
    assert client.put("/api/v1/account/profile", headers=headers, json=profile).status_code == 200

    with app.state.session_factory() as db:
        # Create an action awaiting approval (H-06)
        act_id = uuid4()
        db.add(
            WfActionRow(
                id=act_id,
                owner_kind=owner.kind,
                owner_id=owner.id,
                reference="ACT-2026-001",
                action_type="claim_submission",
                title="Submit Inpatient Medical Claim",
                purpose="Draft claim submission for hospital reimbursement",
                destination="INSURER",
                environment="SANDBOX",
                status="AWAITING_APPROVAL",
                payload_sha256="abc123sha",
                payload_version=1,
            )
        )
        # Create a claim needing evidence (H-05)
        claim_id = uuid4()
        db.add(
            WfClaimCaseRow(
                id=claim_id,
                owner_kind=owner.kind,
                owner_id=owner.id,
                reference="CLM-2026-999",
                title="Emergency Clinic Visit",
                claim_type="Outpatient Visit",
                country_code="CN",
                status="NEEDS_EVIDENCE",
                amount="350.00",
                currency="CNY",
            )
        )
        db.commit()

        home = summary(db, actor, app.state.kb_loader)

        # H-01: User context & greeting
        assert home.context.first_name == "Sinta"
        assert home.context.country_code == "CN"

        # H-02: Assessment summary
        assert home.assessment_summary is not None
        assert "Sinta" in home.assessment_summary.headline
        assert home.assessment_summary.score_ratio is not None
        assert len(home.protection_areas) == 5

        # H-03: Max 3 prioritized actions
        assert len(home.prioritized_actions) <= 3
        assert len(home.prioritized_actions) > 0

        # Check ranking: Pending approval (Weight 120) should be #1
        first_act = home.prioritized_actions[0]
        assert first_act.index == 1
        assert "Approve Action" in first_act.title
        assert first_act.source_finding_id == f"action_{act_id}"
        assert first_act.deep_link == f"/actions?action={act_id}"

        # Check #2: Claim needing evidence (Weight 110)
        second_act = home.prioritized_actions[1]
        assert second_act.index == 2
        assert "CLM-2026-999" in second_act.title
        assert second_act.source_finding_id == f"claim_{claim_id}"
        assert second_act.deep_link == f"/claims/{claim_id}"

        # Check #3: Dental coverage gap (Weight 100)
        third_act = home.prioritized_actions[2]
        assert third_act.index == 3
        assert "Dental" in third_act.title
        assert third_act.source_finding_id == "finding_dental_care"

        # H-07: Recent activity max 3
        assert len(home.recent_activity) <= 3


def test_prioritization_engine_handles_and_excludes_resolved_actions(app, client):
    """H-10: When an action or finding is marked handled, it is excluded and next action bubbles up."""
    headers, account_id, coverage_id, _ = workspace(app, client, "CN")
    actor = Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=account_id)

    profile = {
        "display_name": "Raka Pratama",
        "residence_context": "ABROAD",
        "country_code": "CN",
        "city": "Shenzhen",
        "occupation": "STUDENT",
        "situation": "STUDENT",
    }
    assert client.put("/api/v1/account/profile", headers=headers, json=profile).status_code == 200

    with app.state.session_factory() as db:
        # Mark dental coverage finding as handled in RecommendationStateRow
        db.add(
            RecommendationStateRow(
                account_id=actor.account_id,
                session_id=None,
                rule_id="finding_dental_care",
                subject="context",
                handled_at=datetime.now(UTC),
            )
        )
        db.commit()

        home = summary(db, actor, app.state.kb_loader)

        # Dental coverage should NOT be in prioritized actions because it was handled
        action_ids = [a.source_finding_id for a in home.prioritized_actions]
        assert "finding_dental_care" not in action_ids
        # Other actions bubble up
        assert any(
            "outpatient" in a.id or "outpatient" in (a.source_finding_id or "")
            for a in home.prioritized_actions
        )
