"""Tests for Ask intent router, tool planner, and proposal-to-action draft preparation (B2.4, B2.7)."""

from uuid import UUID

from app.workflow.models import WfActionRow


def test_reminder_intent_returns_proposal_without_provider_and_prepares_idempotent_draft(
    app, client, demo, db_session
):
    session, headers = demo("raka")
    for purpose in ("process_documents", "external_ai"):
        assert (
            client.post(
                "/api/v1/consents", headers=headers, json={"purpose": purpose, "granted": True}
            ).status_code
            == 200
        )

    res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Remind me before my policy expires"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["intent"] == "REMINDER_REQUEST"
    assert body["disposition"] == "answered"
    assert any(step["tool"] == "schedule_coverage_reminder" for step in body["tool_steps"])
    assert len(body["proposals"]) == 1
    proposal = body["proposals"][0]
    assert proposal["action_type"] == "internal_reminder"
    assert proposal["requires_approval"] is True

    # Prepare draft action idempotently
    prep1 = client.post(
        f"/api/v1/ask/proposals/{proposal['proposal_id']}/prepare",
        headers=headers,
    )
    assert prep1.status_code == 200, prep1.text
    prep2 = client.post(
        f"/api/v1/ask/proposals/{proposal['proposal_id']}/prepare",
        headers=headers,
    )
    assert prep2.status_code == 200, prep2.text
    assert prep1.json()["action_id"] == prep2.json()["action_id"]
    assert prep1.json()["status"] == "AWAITING_APPROVAL"

    action_row = db_session.get(WfActionRow, UUID(prep1.json()["action_id"]))
    assert action_row is not None
    assert action_row.status == "AWAITING_APPROVAL"
    assert action_row.action_type == "internal_reminder"
    assert str(action_row.owner_id) == session["id"]

    # Another demo session cannot prepare a proposal targeting Raka's coverage id
    _, other_headers = demo("sinta")
    foreign_prep = client.post(
        f"/api/v1/ask/proposals/{proposal['proposal_id']}/prepare",
        headers=other_headers,
    )
    assert foreign_prep.status_code == 404
