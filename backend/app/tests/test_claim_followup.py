"""Tests for proactive claim follow-up via worker polling and approval-gated follow-up drafts (B3.6)."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.agent import worker
from app.workflow import sandbox, states
from app.workflow.models import WfActionRow, WfClaimCaseRow, WfReminderRow, WfSandboxClaimRow


def test_claim_followup_poll_creates_task_and_approval_gated_draft(client, demo, db_session):
    session_id, headers = demo("raka")
    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    cases_res = client.get("/api/v1/workflow/claims/cases", headers=headers)
    assert cases_res.status_code == 200
    submitted = next(c for c in cases_res.json()["cases"] if c["sandbox_reference"] is not None)
    claim_id = UUID(submitted["id"])

    case_row = db_session.get(WfClaimCaseRow, claim_id)
    assert case_row is not None
    sbx_row = db_session.scalar(
        select(WfSandboxClaimRow).where(WfSandboxClaimRow.claim_ref == case_row.sandbox_ref)
    )
    assert sbx_row is not None
    now = datetime.now(UTC)

    # Set case to PROCESSING in local state while sandbox requests additional info
    case_row.status = states.PROCESSING
    case_row.sandbox_status = sandbox.PROCESSING
    case_row.monitoring_enabled = True
    case_row.monitoring_state = "ACTIVE"
    case_row.next_poll_at = now - timedelta(seconds=5)

    sbx_row.status = sandbox.PROCESSING
    sandbox.operator_decision(
        db_session,
        sbx_row,
        sandbox.ADDITIONAL_INFO,
        "Sandbox review requested medical report and prescription.",
        ["MEDICAL_REPORT", "PRESCRIPTION"],
    )
    db_session.commit()

    factory = sessionmaker(
        bind=db_session.get_bind(),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    processed = worker.process_due(factory, now=now + timedelta(seconds=60))
    assert processed >= 1

    db_session.expire_all()
    updated_case = db_session.get(WfClaimCaseRow, claim_id)
    assert updated_case is not None
    assert updated_case.status == states.ADDITIONAL_INFO

    # Follow-up reminder task created
    task_rem = db_session.scalar(
        select(WfReminderRow).where(
            WfReminderRow.owner_kind == "DEMO",
            WfReminderRow.owner_id == updated_case.owner_id,
            WfReminderRow.claim_id == updated_case.id,
            WfReminderRow.kind == "CLAIM_TASK",
        )
    )
    assert task_rem is not None
    assert "missing evidence" in task_rem.title.lower()

    # Follow-up message draft created in AWAITING_APPROVAL (never auto-sent)
    followup_action = db_session.scalar(
        select(WfActionRow).where(
            WfActionRow.owner_kind == "DEMO",
            WfActionRow.owner_id == updated_case.owner_id,
            WfActionRow.claim_id == updated_case.id,
            WfActionRow.action_type == "claim_follow_up_message",
        )
    )
    assert followup_action is not None
    assert followup_action.status == "AWAITING_APPROVAL"
