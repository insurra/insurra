"""Tests for workflow action types, server-built payloads, version/hash binding, and honest receipts (B3.3, B7.4)."""

import pytest


@pytest.mark.parametrize(
    ("action_type", "expected_env", "expected_status", "expected_phrase"),
    [
        ("renewal_inquiry", "MANUAL_HANDOFF", "NOT_SENT", "Draft prepared. Not sent."),
        (
            "policy_clarification_inquiry",
            "MANUAL_HANDOFF",
            "NOT_SENT",
            "Draft prepared. Not sent.",
        ),
        ("employer_benefit_inquiry", "MANUAL_HANDOFF", "NOT_SENT", "Draft prepared. Not sent."),
        ("policy_servicing_request", "MANUAL_HANDOFF", "NOT_SENT", "Draft prepared. Not sent."),
        (
            "calendar_reminder_file",
            "MANUAL_HANDOFF",
            "NOT_SENT",
            "Calendar file generated. Draft prepared. Not sent.",
        ),
        ("internal_reminder", "INTERNAL", "EXECUTED", "Reminder scheduled in INSURRA."),
    ],
)
def test_action_types_lifecycle_and_honest_receipts(
    client,
    demo,
    action_type: str,
    expected_env: str,
    expected_status: str,
    expected_phrase: str,
):
    _, headers = demo("raka")
    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    create_res = client.post(
        "/api/v1/workflow/actions",
        headers={**headers, "Idempotency-Key": f"idem-{action_type}-1"},
        json={
            "action_type": action_type,
            "draft_inputs": {
                "benefit_query": "Emergency room direct billing rules",
                "request_type": "CERTIFICATE_REPLACEMENT",
                "reason": "Updated student registration",
            },
        },
    )
    assert create_res.status_code == 200, create_res.text
    action = create_res.json()
    action_id = action["id"]
    assert action["action_type"] == action_type
    assert action["environment"] == expected_env
    assert action["status"] == "AWAITING_APPROVAL"
    assert action["payload_version"] == 1

    # Unapproved execution must be blocked with 403 ACTION_NOT_APPROVED
    unapproved_exec = client.post(
        f"/api/v1/workflow/actions/{action_id}/execute",
        headers=headers,
    )
    assert unapproved_exec.status_code == 403
    assert unapproved_exec.json()["code"] == "ACTION_NOT_APPROVED"

    # Approve with exact hash and version
    approve_res = client.post(
        f"/api/v1/workflow/actions/{action_id}/approve",
        headers=headers,
        json={
            "payload_sha256": action["payload_sha256"],
            "payload_version": action["payload_version"],
            "confirm": True,
        },
    )
    assert approve_res.status_code == 200, approve_res.text
    assert approve_res.json()["status"] == "APPROVED"

    # Execute approved action
    exec_res = client.post(
        f"/api/v1/workflow/actions/{action_id}/execute",
        headers=headers,
    )
    assert exec_res.status_code == 200, exec_res.text
    exec_body = exec_res.json()
    receipt = exec_body["receipt"]
    assert receipt["status"] == expected_status
    assert expected_phrase in receipt["notice"] or expected_phrase in receipt["next_action"]


def test_action_edit_increments_version_and_invalidates_prior_approval(client, demo):
    _, headers = demo("raka")
    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    create_res = client.post(
        "/api/v1/workflow/actions",
        headers=headers,
        json={
            "action_type": "renewal_inquiry",
            "draft_inputs": {"subject": "Initial subject"},
        },
    )
    assert create_res.status_code == 200
    action = create_res.json()
    action_id = action["id"]
    v1_sha = action["payload_sha256"]

    # Approve v1
    app_v1 = client.post(
        f"/api/v1/workflow/actions/{action_id}/approve",
        headers=headers,
        json={"payload_sha256": v1_sha, "payload_version": 1},
    )
    assert app_v1.status_code == 200
    assert app_v1.json()["status"] == "APPROVED"

    # Edit payload -> version becomes 2, status resets to AWAITING_APPROVAL
    edit_res = client.patch(
        f"/api/v1/workflow/actions/{action_id}",
        headers=headers,
        json={"changes": {"subject": "Edited subject for renewal"}},
    )
    assert edit_res.status_code == 200
    edited = edit_res.json()
    assert edited["payload_version"] == 2
    assert edited["status"] == "AWAITING_APPROVAL"
    assert edited["approved"] is False
    assert edited["payload_sha256"] != v1_sha

    # Approving with stale version 1 fails with 409 PAYLOAD_VERSION_STALE
    stale_app = client.post(
        f"/api/v1/workflow/actions/{action_id}/approve",
        headers=headers,
        json={"payload_sha256": edited["payload_sha256"], "payload_version": 1},
    )
    assert stale_app.status_code == 409
    assert stale_app.json()["code"] == "PAYLOAD_VERSION_STALE"

    # Approving with wrong hash fails with 409 APPROVAL_HASH_MISMATCH
    bad_hash_app = client.post(
        f"/api/v1/workflow/actions/{action_id}/approve",
        headers=headers,
        json={"payload_sha256": v1_sha, "payload_version": 2},
    )
    assert bad_hash_app.status_code == 409
    assert bad_hash_app.json()["code"] == "APPROVAL_HASH_MISMATCH"


def test_action_rejects_foreign_entity_id(client, demo):
    _, raka_headers = demo("raka")
    _, sinta_headers = demo("sinta")

    sinta_claims = client.get("/api/v1/workflow/claims/cases", headers=sinta_headers).json()[
        "cases"
    ]
    assert len(sinta_claims) >= 1
    foreign_claim_id = sinta_claims[0]["id"]

    res = client.post(
        "/api/v1/workflow/actions",
        headers=raka_headers,
        json={
            "action_type": "claim_follow_up_message",
            "entity_type": "claim",
            "entity_id": foreign_claim_id,
        },
    )
    assert res.status_code == 404
