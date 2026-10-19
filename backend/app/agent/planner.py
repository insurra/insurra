"""Bounded planner mapping intents to tool steps and approval-gated action proposals."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dependencies import owner_for
from app.core.errors import AppError
from app.schemas.actor import Actor
from app.schemas.foundation import (
    ActionProposal,
    AskIntent,
    PreparedProposalAction,
    ToolStep,
)
from app.services.approval import payload_sha256
from app.services.events import dispatch
from app.services.kb_loader import CountryKBLoader
from app.services.workspace import coverages, owned_coverage, profile
from app.workflow.audit import record as record_wf_audit
from app.workflow.models import WfActionRow


def build_plan(
    intent: AskIntent,
    items: list,
    clauses: list | None = None,
    has_uncertain_points: bool = False,
) -> tuple[list[ToolStep], list[ActionProposal]]:
    clauses = clauses or []
    primary = items[0] if items else None
    cov_id = str(primary.id) if primary else None

    if intent == "REMINDER_REQUEST":
        steps = [
            ToolStep(
                tool="get_user_coverages",
                status="COMPLETED",
                summary=f"Loaded {len(items)} owned coverage record(s).",
            ),
            ToolStep(
                tool="schedule_coverage_reminder",
                status="PROPOSED",
                summary="Prepared an internal reminder proposal awaiting user approval.",
            ),
        ]
        proposals = (
            [
                ActionProposal(
                    proposal_id=f"internal_reminder:{cov_id}",
                    action_type="internal_reminder",
                    title="Schedule policy expiry reminder",
                    summary=(
                        f"Create an internal reminder before {primary.provider or primary.kind} "
                        f"expires on {primary.end or 'its end date'}."
                    ),
                    target_entity=cov_id,
                    requires_approval=True,
                )
            ]
            if cov_id
            else []
        )
        return steps, proposals

    if intent == "SERVICING_REQUEST":
        steps = [
            ToolStep(
                tool="get_user_coverages",
                status="COMPLETED",
                summary=f"Loaded {len(items)} owned coverage record(s).",
            ),
            ToolStep(
                tool="prepare_policy_servicing_request",
                status="PROPOSED",
                summary="Prepared a manual policy servicing draft proposal.",
            ),
        ]
        proposals = (
            [
                ActionProposal(
                    proposal_id=f"policy_servicing_request:{cov_id}",
                    action_type="policy_servicing_request",
                    title="Prepare policy servicing request",
                    summary=(
                        f"Prepare a manual servicing request draft for "
                        f"{primary.provider or primary.kind}."
                    ),
                    target_entity=cov_id,
                    requires_approval=True,
                )
            ]
            if cov_id
            else []
        )
        return steps, proposals

    if intent == "COVERAGE_STATUS":
        steps = [
            ToolStep(
                tool="get_protection_insights",
                status="COMPLETED",
                summary="Evaluated deterministic protection insights for owned coverage.",
            ),
            ToolStep(
                tool="evaluate_coverage_continuity",
                status="COMPLETED",
                summary="Computed inclusive coverage continuity against profile dates.",
            ),
        ]
        proposals = (
            [
                ActionProposal(
                    proposal_id=f"renewal_inquiry:{cov_id}",
                    action_type="renewal_inquiry",
                    title="Prepare renewal inquiry draft",
                    summary=(
                        f"Prepare a manual renewal inquiry draft for "
                        f"{primary.provider or primary.kind}."
                    ),
                    target_entity=cov_id,
                    requires_approval=True,
                )
            ]
            if cov_id
            else []
        )
        return steps, proposals

    if intent == "CLAIM_HELP":
        steps = [
            ToolStep(
                tool="get_user_coverages",
                status="COMPLETED",
                summary=f"Loaded {len(items)} owned coverage record(s).",
            ),
            ToolStep(
                tool="get_claim_requirements",
                status="COMPLETED",
                summary="Checked jurisdiction claim evidence checklist.",
            ),
        ]
        proposals = (
            [
                ActionProposal(
                    proposal_id=f"policy_clarification_inquiry:{cov_id}",
                    action_type="policy_clarification_inquiry",
                    title="Prepare claim requirements inquiry",
                    summary=(
                        f"Prepare a manual inquiry draft to confirm claim documents for "
                        f"{primary.provider or primary.kind}."
                    ),
                    target_entity=cov_id,
                    requires_approval=True,
                )
            ]
            if cov_id
            else []
        )
        return steps, proposals

    if intent == "CARE_NAVIGATION":
        return (
            [
                ToolStep(
                    tool="compare_supported_care_pathways",
                    status="COMPLETED",
                    summary="Directed to non-emergency Care Pathways comparison.",
                )
            ],
            [],
        )

    if intent in ("MEDICAL_ADVICE", "OUT_OF_SCOPE"):
        return [], []

    # POLICY_QUESTION
    steps = [
        ToolStep(
            tool="get_user_coverages",
            status="COMPLETED",
            summary=f"Loaded {len(items)} owned coverage record(s).",
        ),
        ToolStep(
            tool="retrieve_applicable_policy_clauses",
            status="COMPLETED",
            summary=f"Retrieved {len(clauses)} matching clause(s) from retained pages.",
        ),
    ]
    proposals: list[ActionProposal] = []
    if cov_id and (not clauses or has_uncertain_points):
        proposals.append(
            ActionProposal(
                proposal_id=f"policy_clarification_inquiry:{cov_id}",
                action_type="policy_clarification_inquiry",
                title="Prepare policy clarification inquiry",
                summary=(
                    f"Prepare a manual inquiry draft to confirm benefit details for "
                    f"{primary.provider or primary.kind}."
                ),
                target_entity=cov_id,
                requires_approval=True,
            )
        )
    return steps, proposals


def prepare_proposal_action(
    db: Session,
    actor: Actor,
    kb: CountryKBLoader,
    proposal_id: str,
) -> PreparedProposalAction:
    """Create or return an idempotent AWAITING_APPROVAL wf_actions draft for an Ask proposal."""
    if ":" not in proposal_id:
        raise AppError(422, "INVALID_PROPOSAL", "Proposal identifier is invalid.")
    action_type, raw_target = proposal_id.split(":", 1)
    allowed_types = {
        "internal_reminder",
        "policy_servicing_request",
        "renewal_inquiry",
        "policy_clarification_inquiry",
        "employer_benefit_inquiry",
    }
    if action_type not in allowed_types:
        raise AppError(422, "INVALID_PROPOSAL", "Unsupported proposal action type.")
    try:
        target_uuid = UUID(raw_target)
    except ValueError as exc:
        raise AppError(422, "INVALID_PROPOSAL", "Proposal target must be a valid UUID.") from exc

    p = profile(db, actor)
    owned_items = coverages(db, actor, kb)
    cov = owned_coverage(owned_items, target_uuid)

    owner = owner_for(actor)
    idem_key = f"ask-proposal:{proposal_id}"
    existing = db.scalar(
        select(WfActionRow).where(
            WfActionRow.owner_kind == owner.kind,
            WfActionRow.owner_id == owner.id,
            WfActionRow.dedupe_key == idem_key,
        )
    )
    if existing is not None:
        return PreparedProposalAction(
            action_id=existing.id,
            status=existing.status,
            action_type=existing.action_type,
        )

    now = datetime.now(UTC)
    payload = {
        "action_type": action_type,
        "coverage_id": str(cov.id),
        "provider": cov.provider or cov.kind,
        "policy_kind": cov.kind,
        "country_code": p.country_code,
        "coverage_end_date": cov.end.isoformat() if cov.end else None,
        "delivery_mode": "INTERNAL_REMINDER"
        if action_type == "internal_reminder"
        else "MANUAL_HANDOFF_ONLY",
        "subject": f"{action_type.replace('_', ' ').title()} - {cov.provider or cov.kind}",
        "body": (
            f"Reminder for {cov.provider or cov.kind} ending on {cov.end.isoformat() if cov.end else 'unknown date'}."
            if action_type == "internal_reminder"
            else f"Draft inquiry regarding {cov.provider or cov.kind} ({cov.kind}) for review before manual sending."
        ),
    }
    sha = payload_sha256(payload)
    title_map = {
        "internal_reminder": f"Schedule reminder for {cov.provider or cov.kind}",
        "policy_servicing_request": f"Policy servicing request for {cov.provider or cov.kind}",
        "renewal_inquiry": f"Renewal inquiry draft for {cov.provider or cov.kind}",
        "policy_clarification_inquiry": f"Policy clarification draft for {cov.provider or cov.kind}",
        "employer_benefit_inquiry": f"Employer benefit inquiry for {cov.provider or cov.kind}",
    }
    action_id = uuid4()
    action = WfActionRow(
        id=action_id,
        owner_kind=owner.kind,
        owner_id=owner.id,
        reference=f"ACT-{str(action_id)[:8].upper()}",
        claim_id=None,
        action_type=action_type,
        title=title_map[action_type][:200],
        purpose="Prepared from Ask assistant. Requires your explicit approval before execution.",
        destination="INTERNAL_REMINDER" if action_type == "internal_reminder" else "MANUAL_HANDOFF",
        environment="SANDBOX",
        payload=payload,
        payload_sha256=sha,
        payload_version=1,
        status="AWAITING_APPROVAL",
        required_permissions=["process_documents"],
        expires_at=now + timedelta(hours=24),
        dedupe_key=idem_key,
        ai_prepared=True,
        created_at=now,
        updated_at=now,
    )
    db.add(action)
    record_wf_audit(
        db,
        owner,
        event_type="ACTION_PREPARED",
        category="ACTIONS",
        title=action.title,
        summary=f"Prepared {action_type} draft in AWAITING_APPROVAL.",
        actor_type="AI_PREPARED",
        action_id=action.id,
        details={
            "action_type": action_type,
            "action_reference": action.reference,
            "status": "AWAITING_APPROVAL",
            "payload_digest": sha,
        },
    )
    dispatch(
        db,
        owner,
        event_type="action.prepared",
        entity_type="action",
        entity_id=action.id,
        meta={"action_type": action_type, "status": "AWAITING_APPROVAL"},
        dedupe_key=f"action.prepared:{action.id}:1",
    )
    db.commit()
    return PreparedProposalAction(
        action_id=action.id,
        status=action.status,
        action_type=action.action_type,
    )
