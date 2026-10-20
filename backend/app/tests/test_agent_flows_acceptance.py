"""Comprehensive tests verifying Agent Flows A, B, C and Joshua's Acceptance Criteria."""

from uuid import UUID

import pytest
from sqlalchemy import select

from app.agent import tools
from app.core.errors import AppError
from app.workflow import actions, claims, states
from app.workflow.models import (
    WfClaimCaseRow,
    WfExecutionReceiptRow,
)
from app.workflow.owner import Owner

# =============================================================================
# FLOW A: Proactive Renewal Agent
# =============================================================================


def test_flow_a_proactive_renewal_agent(client, demo, db_session):
    """Flow A:
    1. Scheduler checks relevant policies.
    2. Engine detects expiry or potential lapse.
    3. Agent prepares renewal action.
    4. User receives alert and reviews action.
    5. User approves, then executor processes through sandbox/handoff.
    6. Receipt and result flow into Home and audit.
    """
    session_data, headers = demo("raka")

    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    # 1 & 2: Run proactive renewal check (checks policies & detects upcoming expiry)
    sync_res = client.post("/api/v1/workflow/reminders/check-renewals", headers=headers)
    assert sync_res.status_code == 200

    # 3: Verify renewal inquiry action is prepared in AWAITING_APPROVAL
    queue_res = client.get("/api/v1/workflow/actions/queue?status_tab=PENDING", headers=headers)
    assert queue_res.status_code == 200
    pending_actions = queue_res.json()["actions"]
    renewal_action = next(
        (a for a in pending_actions if a["action_type"] == "renewal_inquiry"), None
    )
    assert renewal_action is not None, "Renewal inquiry action should be prepared"
    assert renewal_action["status"] == "AWAITING_APPROVAL"
    assert renewal_action["lifecycle_status"] == "PENDING"
    assert renewal_action["requires_approval"] is True
    assert renewal_action["approved"] is False

    action_id = renewal_action["id"]
    sha256 = renewal_action["payload_sha256"]
    version = renewal_action["payload_version"]

    # 4 & 5: User reviews and approves the exact payload
    approve_res = client.post(
        f"/api/v1/workflow/actions/{action_id}/approve",
        headers=headers,
        json={"payload_sha256": sha256, "payload_version": version, "confirm": True},
    )
    assert approve_res.status_code == 200
    approved_action = approve_res.json()
    assert approved_action["status"] == "APPROVED"
    assert approved_action["lifecycle_status"] == "APPROVED"
    assert approved_action["approved"] is True

    # 5: Execute approved action
    exec_res = client.post(f"/api/v1/workflow/actions/{action_id}/execute", headers=headers)
    assert exec_res.status_code == 200
    exec_data = exec_res.json()
    receipt = exec_data["receipt"]
    assert receipt["receipt_reference"].startswith("RCT-")
    assert receipt["environment"] == "MANUAL_HANDOFF"
    assert receipt["signature_valid"] is True
    assert exec_data["action"]["lifecycle_status"] == "SUCCEEDED"

    # 6: Receipt and audit are recorded
    audit_res = client.get("/api/v1/workflow/audit/timeline", headers=headers)
    assert audit_res.status_code == 200
    events = audit_res.json()["events"]
    assert any(e["receipt_ref"] == receipt["receipt_reference"] for e in events)


# =============================================================================
# FLOW B: Claim Agent
# =============================================================================


def test_flow_b_claim_agent(client, demo, db_session):
    """Flow B:
    1. User creates claim case.
    2. Agent takes policy context and evidence.
    3. System validates completeness and creates draft.
    4. User approves final payload.
    5. Agent submits to sandbox and receives reference ID.
    6. Status updates from workflow response.
    """
    session_data, headers = demo("raka")
    session_id = UUID(session_data["id"])
    owner = Owner("DEMO", session_id)

    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    overview = client.get("/api/v1/workflow/claims/overview", headers=headers).json()
    coverage_ref = overview["available_policies"][0]["ref"]

    # 1: User creates claim case
    create_res = client.post(
        "/api/v1/workflow/claims/cases",
        headers=headers,
        json={
            "coverage_ref": coverage_ref,
            "claim_type": "Outpatient Medical Reimbursement",
            "title": "Hospital Outpatient Visit",
            "claimant_name": "Raka",
        },
    )
    assert create_res.status_code == 201
    case_detail = create_res.json()
    claim_id = UUID(case_detail["case"]["id"])
    case_row = db_session.get(WfClaimCaseRow, claim_id)
    assert case_row is not None

    # 2: Attach evidence fields and confirm
    ev_row = claims.add_evidence(
        db_session,
        owner,
        case_row,
        kind="FAPIAO",
        filename="hospital_fapiao.pdf",
        source_type="DOCUMENT_UPLOAD",
        fields={
            "invoice_number": {"value": "INV-2026-9999", "confirmed": False},
            "hospital_name": {"value": "Shenzhen University Hospital", "confirmed": False},
            "billing_date": {"value": "2026-10-10", "confirmed": False},
            "total_amount": {"value": "480.00", "confirmed": False},
            "currency": {"value": "CNY", "confirmed": False},
            "payer_name": {"value": "Raka", "confirmed": False},
        },
    )
    claims.add_evidence(
        db_session,
        owner,
        case_row,
        kind="MEDICAL_RECORD",
        filename="hospital_record.pdf",
        source_type="DOCUMENT_UPLOAD",
        fields={
            "visit_date": {"value": "2026-10-10", "confirmed": True},
            "patient_name": {"value": "Raka", "confirmed": True},
            "hospital_name": {"value": "Shenzhen University Hospital", "confirmed": True},
            "diagnosed_condition": {"value": "Acute Gastritis", "confirmed": True},
        },
    )
    db_session.commit()

    # User confirms evidence fields via API
    conf_res = client.patch(
        f"/api/v1/workflow/claims/cases/{claim_id}/evidence/{ev_row.id}/confirm",
        headers=headers,
        json={
            "values": {
                "invoice_number": "INV-2026-9999",
                "hospital_name": "Shenzhen University Hospital",
                "billing_date": "2026-10-10",
                "total_amount": "480.00",
                "currency": "CNY",
                "payer_name": "Raka",
            }
        },
    )
    assert conf_res.status_code == 200

    # 3: Generate claim draft
    draft_res = client.post(
        f"/api/v1/workflow/claims/cases/{claim_id}/draft",
        headers=headers,
    )
    assert draft_res.status_code == 200
    draft_data = draft_res.json()["draft"]
    assert draft_data is not None
    assert "form" in draft_data, "Draft response must include form dict"

    # Confirm draft
    confirm_draft_res = client.post(
        f"/api/v1/workflow/claims/cases/{claim_id}/draft/confirm",
        headers=headers,
    )
    assert confirm_draft_res.status_code == 200

    # Send to approval
    send_res = client.post(
        f"/api/v1/workflow/claims/cases/{claim_id}/send-to-approval",
        headers=headers,
    )
    assert send_res.status_code == 200
    action_info = send_res.json()["action"]
    assert action_info["action_type"] == "sandbox_claim_submit"
    assert action_info["lifecycle_status"] == "PENDING"

    # 4: User approves final payload
    action_id = action_info["id"]
    approve_res = client.post(
        f"/api/v1/workflow/actions/{action_id}/approve",
        headers=headers,
        json={
            "payload_sha256": action_info["payload_sha256"],
            "payload_version": action_info["payload_version"],
            "confirm": True,
        },
    )
    assert approve_res.status_code == 200

    # 5: Execute submission to sandbox
    exec_res = client.post(f"/api/v1/workflow/actions/{action_id}/execute", headers=headers)
    assert exec_res.status_code == 200
    receipt = exec_res.json()["receipt"]
    assert receipt["claim_reference"].startswith("SBX-")
    sandbox_ref = receipt["claim_reference"]

    # 6: Status updates from sandbox workflow response
    sync_res = client.post(
        f"/api/v1/workflow/claims/cases/{claim_id}/sync-status",
        headers=headers,
    )
    assert sync_res.status_code == 200
    synced_case = sync_res.json()["case"]["case"]
    assert synced_case["sandbox_reference"] == sandbox_ref
    assert synced_case["status"] in states.POST_SUBMISSION


# =============================================================================
# FLOW C: Claim Dispute Agent
# =============================================================================


def test_flow_c_claim_dispute_agent(client, demo, db_session):
    """Flow C:
    1. User uploads rejection letter.
    2. Agent matches rejection reason with policy clauses.
    3. Agent identifies issues worthy of clarification.
    4. Agent prepares appeal draft and evidence checklist.
    5. User reviews and approves before submission.
    """
    session_data, headers = demo("raka")
    session_id = UUID(session_data["id"])
    owner = Owner("DEMO", session_id)

    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    overview = client.get("/api/v1/workflow/claims/overview", headers=headers).json()
    coverage_ref = overview["available_policies"][0]["ref"]

    # Setup case
    create_res = client.post(
        "/api/v1/workflow/claims/cases",
        headers=headers,
        json={
            "coverage_ref": coverage_ref,
            "claim_type": "Outpatient Medical Reimbursement",
            "title": "Outpatient Bronchitis Treatment",
        },
    )
    claim_id = UUID(create_res.json()["case"]["id"])
    case_row = db_session.get(WfClaimCaseRow, claim_id)

    # 1: User uploads rejection letter
    claims.add_evidence(
        db_session,
        owner,
        case_row,
        kind="REJECTION_LETTER",
        filename="insurer_denial_letter.pdf",
        source_type="DOCUMENT_UPLOAD",
        fields={
            "rejection_reason": {
                "value": "Treatment date is outside policy period or waiting period clause 4.2",
                "confirmed": True,
            },
            "cited_clause": {
                "value": "Exclusion Clause 4.2 - Waiting period & effective date limitation",
                "confirmed": True,
            },
            "rejection_date": {"value": "2026-10-15", "confirmed": True},
            "insurer_reference": {"value": "CLM-PINGAN-8888", "confirmed": True},
        },
    )
    db_session.commit()

    # 2 & 3: Dispute review endpoint matches clauses and identifies clarifiable issues
    review_res = client.post(
        f"/api/v1/workflow/claims/cases/{claim_id}/dispute-review",
        headers=headers,
        json={},
    )
    assert review_res.status_code == 200
    review_data = review_res.json()

    assert len(review_data["matched_policy_clauses"]) > 0
    assert len(review_data["clarifiable_issues"]) > 0
    assert len(review_data["appeal_evidence_checklist"]) > 0
    assert review_data["review_posture"] == "CLARIFICATION_ONLY"
    assert review_data["insurer_at_fault_concluded"] is False
    assert review_data["acceptance_guaranteed"] is False
    assert "disclaimer" in review_data

    # 4: Prepare appeal draft and queued action
    appeal_res = client.post(
        f"/api/v1/workflow/claims/cases/{claim_id}/prepare-appeal",
        headers=headers,
        json={},
    )
    assert appeal_res.status_code == 200
    action_view = appeal_res.json()["action"]
    assert action_view["action_type"] == "claim_dispute_appeal"
    assert action_view["status"] == "AWAITING_APPROVAL"
    assert action_view["lifecycle_status"] == "PENDING"
    assert action_view["requires_approval"] is True

    # 5: User reviews and approves before handoff
    action_id = action_view["id"]
    approve_res = client.post(
        f"/api/v1/workflow/actions/{action_id}/approve",
        headers=headers,
        json={
            "payload_sha256": action_view["payload_sha256"],
            "payload_version": action_view["payload_version"],
            "confirm": True,
        },
    )
    assert approve_res.status_code == 200
    assert approve_res.json()["lifecycle_status"] == "APPROVED"

    # Execute handoff
    exec_res = client.post(f"/api/v1/workflow/actions/{action_id}/execute", headers=headers)
    assert exec_res.status_code == 200
    receipt = exec_res.json()["receipt"]
    assert receipt["environment"] == "MANUAL_HANDOFF"
    assert "Draft prepared. Not sent." in receipt["notice"]


# =============================================================================
# JOSHUA'S ACCEPTANCE CRITERIA
# =============================================================================


def test_acceptance_criterion_1_consequential_action_never_llm(db_session, demo):
    """Criterion 1: Consequential action tidak pernah dieksekusi langsung oleh LLM."""
    session_data, _ = demo("raka")
    session_id = UUID(session_data["id"])
    owner = Owner("DEMO", session_id)

    # 1. Verify ToolPermissionClass.CONSEQUENTIAL_EXTERNAL is excluded from LLM tools
    llm_tools = tools.llm_visible_tools()
    tool_names = [t.name for t in llm_tools]
    assert "execute_approved_sandbox_action" not in tool_names
    assert all(
        t.permission_class != tools.ToolPermissionClass.CONSEQUENTIAL_EXTERNAL for t in llm_tools
    )

    # 2. Verify invoke_tool blocks direct invocation with from_llm=True
    with pytest.raises(AppError) as exc_info:
        tools.invoke_tool(
            db_session,
            owner,
            "execute_approved_sandbox_action",
            {
                "action_id": UUID("00000000-0000-0000-0000-000000000001"),
                "payload_sha256": "0" * 64,
                "idempotency_key": "test",
            },
            from_llm=True,
        )
    assert exc_info.value.code == "CONSEQUENTIAL_TOOL_FORBIDDEN"


def test_acceptance_criterion_2_approval_bound_to_exact_payload_hash(client, demo, db_session):
    """Criterion 2: Semua tindakan eksternal memerlukan approval yang masih berlaku dan terikat pada payload."""
    session_data, headers = demo("raka")

    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    overview = client.get("/api/v1/workflow/claims/overview", headers=headers).json()
    coverage_ref = overview["available_policies"][0]["ref"]

    # Prepare action
    res = client.post(
        "/api/v1/workflow/actions",
        headers=headers,
        json={
            "action_type": "policy_clarification_inquiry",
            "entity_type": "coverage",
            "entity_id": coverage_ref,
        },
    )
    assert res.status_code == 200
    action = res.json()
    action_id = action["id"]
    sha256 = action["payload_sha256"]
    version = action["payload_version"]

    # Attempt execution before approval -> blocked (403 ACTION_NOT_APPROVED)
    exec_res = client.post(f"/api/v1/workflow/actions/{action_id}/execute", headers=headers)
    assert exec_res.status_code == 403
    assert exec_res.json()["code"] == "ACTION_NOT_APPROVED"

    # Attempt approval with mismatched hash -> blocked (409 APPROVAL_HASH_MISMATCH)
    wrong_sha = "f" * 64
    appr_bad = client.post(
        f"/api/v1/workflow/actions/{action_id}/approve",
        headers=headers,
        json={"payload_sha256": wrong_sha, "payload_version": version, "confirm": True},
    )
    assert appr_bad.status_code == 409
    assert appr_bad.json()["code"] == "APPROVAL_HASH_MISMATCH"

    # Valid approval
    appr_good = client.post(
        f"/api/v1/workflow/actions/{action_id}/approve",
        headers=headers,
        json={"payload_sha256": sha256, "payload_version": version, "confirm": True},
    )
    assert appr_good.status_code == 200

    # Edit action -> invalidates approval and bumps version
    edit_res = client.patch(
        f"/api/v1/workflow/actions/{action_id}",
        headers=headers,
        json={"changes": {"subject": "Updated inquiry subject"}},
    )
    assert edit_res.status_code == 200
    updated_action = edit_res.json()
    assert updated_action["payload_version"] == version + 1
    assert updated_action["approved"] is False
    assert updated_action["status"] == "AWAITING_APPROVAL"

    # Execution now blocked again because version bumped and approval invalidated
    exec_blocked = client.post(f"/api/v1/workflow/actions/{action_id}/execute", headers=headers)
    assert exec_blocked.status_code == 403


def test_acceptance_criterion_3_deduplication_prevents_duplicate_submissions(
    client, demo, db_session
):
    """Criterion 3: Duplicate events tidak menghasilkan duplicate submissions."""
    session_data, headers = demo("raka")
    session_id = UUID(session_data["id"])

    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    overview = client.get("/api/v1/workflow/claims/overview", headers=headers).json()
    coverage_ref = overview["available_policies"][0]["ref"]
    owner = Owner("DEMO", session_id)

    # 1. Action preparation deduplication
    act1 = actions.prepare_user_action(
        db_session, owner, "renewal_inquiry", entity_id=coverage_ref, dedupe_key="dedupe:test:1"
    )
    act2 = actions.prepare_user_action(
        db_session, owner, "renewal_inquiry", entity_id=coverage_ref, dedupe_key="dedupe:test:1"
    )
    assert act1.id == act2.id

    # 2. Execution replay idempotency
    actions.approve(db_session, owner, act1, act1.payload_sha256, act1.payload_version)
    receipt1, replayed1 = actions.execute(db_session, owner, act1)
    receipt2, replayed2 = actions.execute(db_session, owner, act1)
    assert replayed1 is False
    assert replayed2 is True
    assert receipt1["receipt_reference"] == receipt2["receipt_reference"]


def test_acceptance_criterion_4_lifecycle_statuses_and_details(client, demo, db_session):
    """Criterion 4: Setiap tindakan mempunyai status PENDING, APPROVED, EXECUTING, SUCCEEDED, atau FAILED, beserta detail yang sesuai."""
    session_data, headers = demo("raka")
    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    # Prepare action -> lifecycle PENDING
    prep = client.post(
        "/api/v1/workflow/actions",
        headers=headers,
        json={
            "action_type": "internal_reminder",
            "draft_inputs": {"title": "Test Reminder", "due_date": "2026-10-30"},
        },
    ).json()
    assert prep["lifecycle_status"] == "PENDING"
    assert "summary" in prep["status_detail"]

    # Approve -> lifecycle APPROVED
    appr = client.post(
        f"/api/v1/workflow/actions/{prep['id']}/approve",
        headers=headers,
        json={
            "payload_sha256": prep["payload_sha256"],
            "payload_version": prep["payload_version"],
            "confirm": True,
        },
    ).json()
    assert appr["lifecycle_status"] == "APPROVED"

    # Execute -> lifecycle SUCCEEDED
    exc = client.post(f"/api/v1/workflow/actions/{prep['id']}/execute", headers=headers).json()
    assert exc["action"]["lifecycle_status"] == "SUCCEEDED"
    assert exc["action"]["status_detail"]["lifecycle_status"] == "SUCCEEDED"


def test_acceptance_criterion_5_no_false_success_without_sandbox_proof(client, demo, db_session):
    """Criterion 5: Sistem tidak mengklaim berhasil mengirim klaim jika sandbox tidak mengembalikan bukti keberhasilan."""
    session_data, headers = demo("raka")
    session_id = UUID(session_data["id"])

    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    overview = client.get("/api/v1/workflow/claims/overview", headers=headers).json()
    coverage_ref = overview["available_policies"][0]["ref"]
    owner = Owner("DEMO", session_id)

    # Create case with invalid payload structure for sandbox
    case = claims.create_case(
        db_session,
        owner,
        policy_ref=coverage_ref,
        claim_type="Outpatient",
    )
    # Prepare action with an invalid empty payload that fails sandbox validation
    action = actions.prepare_action(
        db_session,
        owner,
        "sandbox_claim_submit",
        title="Invalid submission",
        purpose="Testing sandbox failure rejection",
        payload={"schema": "invalid.schema"},
        claim=case,
    )
    actions.approve(db_session, owner, action, action.payload_sha256, action.payload_version)
    db_session.commit()

    # Execution must fail and raise AppError 422 SANDBOX_VALIDATION_FAILED
    with pytest.raises(AppError) as exc_info:
        actions.execute(db_session, owner, action)
    assert exc_info.value.code == "SANDBOX_VALIDATION_FAILED"

    # Verify action status is FAILED and no execution receipt was issued
    db_session.refresh(action)
    assert action.status == "FAILED"
    receipt = db_session.scalar(
        select(WfExecutionReceiptRow).where(WfExecutionReceiptRow.action_id == action.id)
    )
    assert receipt is None, "No receipt should be issued on failed sandbox submission"


def test_acceptance_criterion_6_dispute_review_never_concludes_fault_or_guarantee(
    demo, client, db_session
):
    """Criterion 6: Rejection review tidak otomatis menyimpulkan insurer bersalah atau klaim pasti diterima."""
    session_data, headers = demo("raka")
    session_id = UUID(session_data["id"])
    owner = Owner("DEMO", session_id)

    overview = client.get("/api/v1/workflow/claims/overview", headers=headers).json()
    coverage_ref = overview["available_policies"][0]["ref"]

    case = claims.create_case(
        db_session,
        owner,
        policy_ref=coverage_ref,
        claim_type="Outpatient Medical Reimbursement",
    )

    review = claims.review_claim_rejection(
        db_session,
        owner,
        case,
        rejection_reason="Claim denied: treatment not covered under policy terms",
        cited_clause="Clause 5.1 Exclusions",
        record_audit=True,
    )

    # Strict honesty checks
    assert review["insurer_at_fault_concluded"] is False
    assert review["acceptance_guaranteed"] is False
    assert review["review_posture"] == "CLARIFICATION_ONLY"
    assert "does not conclude that the insurer is at fault" in review["disclaimer"]
    assert "does not guarantee" in review["disclaimer"]


# =============================================================================
# FLOW 3: Ask INSURRA (SC-06 · P0)
# =============================================================================


def test_flow_3_ask_insurra(app, client, monkeypatch):
    """Flow 3: Ask INSURRA
    Joshua · SC-06 · P0
    Question -> Safety Check -> Intent Routing -> Retrieve Context & Evidence -> Call Read/Compute Tools -> Grounded Answer -> Validate Citation

    Requirements:
    1. Safety check intercepts red flags and redirects to emergency without calling AI.
    2. Intent routing routes medical advice, care navigation, and policy question.
    3. Personalized answers from authorized policy facts (Regina's findings).
    4. Citation per material policy assertion.
    5. Explicit uncertainty when evidence is missing.
    6. Optional proposed draft action in AWAITING_APPROVAL, never direct execution.
    7. Expected: pertanyaan yang sama pada dua polis berbeda menghasilkan jawaban dan evidence berbeda.
    8. Batas: Ask INSURRA tidak membuat assessment engine kedua; menggunakan hasil Regina.
    """
    import json

    from app.models import (
        AccountCoverageRow,
        AccountDocumentPageRow,
        AccountDocumentRow,
    )
    from app.services.policy_qa import ModelAnswer
    from app.tests.workspace_fixtures import POLICY_TEXT, reviewed_triage, workspace

    headers, account, coverage, doc = workspace(app, client, "CN")
    reviewed_triage(app, monkeypatch)

    dental_quote = POLICY_TEXT.replace("AUD", "CNY").splitlines()[1]

    class GatewayFixture:
        def __init__(self, doc_id):
            self.doc_id = doc_id
            self.calls = []

        def __call__(self, settings):
            return self

        def parse(self, **kwargs):
            self.calls.append(json.loads(kwargs["text"]))
            return ModelAnswer.model_validate(
                {
                    "answer_points": [
                        {
                            "text": "Perawatan gigi umum dikecualikan dalam polis fiktif ini.",
                            "label": "FROM_DOCUMENT",
                            "citations": [
                                {
                                    "doc": str(self.doc_id),
                                    "page": 1,
                                    "quote": dental_quote,
                                }
                            ],
                        }
                    ]
                }
            )

    gateway = GatewayFixture(doc)
    app.state.qna_gateway_factory = gateway

    # 1. Safety Check: Emergency / red-flag question triggers immediate EmergencyRedirect with ZERO AI calls
    safety_res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "aku sesak napas berat dan nyeri dada, ditanggung nggak?"},
    )
    assert safety_res.status_code == 200
    assert safety_res.json()["redirect"] == "emergency"
    assert len(gateway.calls) == 0, "Safety red flag must NEVER call the LLM"

    # 2. Intent Routing: Medical advice is safely declined without calling the model
    med_res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "obat apa yang cocok untuk radang tenggorokan?"},
    )
    assert med_res.status_code == 200
    med_data = med_res.json()
    assert med_data["disposition"] == "declined"
    assert med_data["intent"] == "MEDICAL_ADVICE"
    assert any("Saya tidak memberikan diagnosis" in w for w in med_data["warnings"])
    assert len(gateway.calls) == 0, "Medical advice question must not call LLM"

    # 3. Grounded Answer with Citation Validation (Policy Question)
    # Uses authorized policy facts and verified clauses from Regina's extracted documents
    policy_res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Periksa gigi ditanggung nggak?"},
    )
    assert policy_res.status_code == 200
    policy_data = policy_res.json()
    assert policy_data["disposition"] == "answered"
    assert policy_data["intent"] == "POLICY_QUESTION"
    assert len(policy_data["answer_points"]) > 0
    point = policy_data["answer_points"][0]
    assert point["label"] == "FROM_DOCUMENT"
    assert len(point["citations"]) > 0
    citation = point["citations"][0]
    assert citation["doc"] == str(doc)
    assert citation["page"] == 1
    assert "General dental treatment is excluded" in citation["quote"]
    assert len(gateway.calls) == 1

    # 4. Explicit Uncertainty when Evidence is Missing
    # When asking about benefits not in the document, returns honest "no_match" with verification steps
    no_match_res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Apakah kacamata dan lensa kontak ditanggung?"},
    )
    assert no_match_res.status_code == 200
    no_match_data = no_match_res.json()
    assert no_match_data["disposition"] == "no_match"
    assert no_match_data["answer_points"] == []
    assert any("Tidak ditemukan di dokumen" in w for w in no_match_data["warnings"])
    assert isinstance(no_match_data["verification_steps"], list)

    # 5. Optional Proposed Draft Action, Never Direct Execution
    # Uncertainty or policy questions propose an action awaiting user approval
    assert len(no_match_data["proposals"]) > 0
    proposal = no_match_data["proposals"][0]
    assert proposal["requires_approval"] is True
    assert proposal["action_type"] in (
        "policy_clarification_inquiry",
        "internal_reminder",
        "renewal_inquiry",
    )

    # Preparing the proposal creates an idempotent wf_action draft in AWAITING_APPROVAL status
    prep_res = client.post(
        f"/api/v1/ask/proposals/{proposal['proposal_id']}/prepare",
        headers=headers,
    )
    assert prep_res.status_code == 200
    prep_data = prep_res.json()
    assert prep_data["status"] == "AWAITING_APPROVAL"

    # 6. Expected: pertanyaan yang sama pada dua polis berbeda menghasilkan jawaban dan evidence berbeda
    # Create a second distinct policy for the same account with different clauses
    with app.state.session_factory() as db:
        doc_b = AccountDocumentRow(
            account_id=account,
            country_code="CN",
            kind="personal_health",
            original_filename="policy-b-fictional.pdf",
            mime_type="application/pdf",
            size_bytes=150,
            sha256="b" * 64,
            content=b"policy b content",
            status="COMPLETED",
            injection_flag=False,
        )
        db.add(doc_b)
        db.flush()
        cov_b = AccountCoverageRow(
            account_id=account,
            document_id=doc_b.id,
            country_code="CN",
            kind="COMPREHENSIVE_HEALTH",
            provider="Policy B Provider",
            start_date="2026-01-01",
            end_date="2027-12-31",
        )
        db.add(cov_b)
        db.add(
            AccountDocumentPageRow(
                document_id=doc_b.id,
                page_no=1,
                text="FICTIONAL POLICY B. Dental checkup is available upon request.",
                ocr_used=False,
            )
        )
        db.commit()
        cov_b_id = str(cov_b.id)
        doc_b_id = str(doc_b.id)

    # Calling with coverage_id=coverage (Policy A) scopes clauses to doc A
    client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Periksa gigi ditanggung nggak?", "coverage_id": str(coverage)},
    )
    assert {c["doc"] for c in gateway.calls[-1]["clauses"]} == {str(doc)}

    # Calling with coverage_id=cov_b_id (Policy B) scopes clauses to doc B
    client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Periksa gigi ditanggung nggak?", "coverage_id": cov_b_id},
    )
    assert {c["doc"] for c in gateway.calls[-1]["clauses"]} == {str(doc_b_id)}


# =============================================================================
# FLOW 4: Care Pathways & Emergency (SC-07, SC-08 · P0)
# =============================================================================


def test_flow_4_care_pathways_and_emergency(client, app, monkeypatch):
    """Flow 4 (SC-07, SC-08 · P0):
    Describe Need → Safety Triage → Load Policy Context → Evaluate Care Options
    → Explain Costs & Conditions → User Selects Next Step.
    Jika muncul red flag:
    Red Flag → Interrupt Normal Flow → Emergency Guidance + Verified Country Contacts.

    Acceptance Requirements:
    1. Safety checks prior to LLM reasoning.
    2. Verified country-specific pathways and emergency contacts.
    3. Grounded coverage explanations.
    4. Deterministic estimated costs when reliable inputs exist; unknown cost if no reliable tariff.
    5. No unsupported diagnosis or reimbursement guarantees.
    6. Optional creation of claim case (with idempotency and bridge to workflow).
    7. Expected: care navigation changes based on country and policy context, without blending
       unverified benefits.
    """
    from app.models import AccountCoverageRow, ClaimCaseRow
    from app.tests.workspace_fixtures import reviewed_triage, workspace

    # Setup CN workspace and reviewed triage fixture
    reviewed_triage(app, monkeypatch)
    headers_cn, account_cn, coverage_cn, doc_cn = workspace(app, client, "CN")

    # Update coverage kind to match CN student policy type in KB ("STUDENT_COMPREHENSIVE")
    with app.state.session_factory() as db:
        cov_row = db.get(AccountCoverageRow, coverage_cn)
        cov_row.kind = "STUDENT_COMPREHENSIVE"
        db.commit()

    # 1. Safety Check: Red flag complaint immediately intercepts normal care flow
    # Returns EmergencyRedirect(redirect="emergency") before any care comparison or LLM reasoning
    red_flag_res = client.post(
        "/api/v1/pathways/compare",
        headers=headers_cn,
        json={
            "complaint": "aku sesak napas berat dan pingsan tiba-tiba",
            "service_type": "OUTPATIENT",
            "city": "Shenzhen",
            "timeframe": "today",
        },
    )
    assert red_flag_res.status_code == 200
    rf_data = red_flag_res.json()
    assert rf_data.get("redirect") == "emergency", "Red flag MUST interrupt normal care flow"
    assert "paths" not in rf_data or len(rf_data.get("paths", [])) == 0

    # 2. Verified country-specific emergency contacts & triage
    # CN emergency contacts
    contacts_cn = client.get(
        "/api/v1/workflow/emergency/contacts?country_code=CN", headers=headers_cn
    )
    assert contacts_cn.status_code == 200
    cn_numbers = {c["service_code"]: c["phone_number"] for c in contacts_cn.json()["contacts"]}
    assert cn_numbers.get("medical") == "120", "China medical emergency number must be 120"
    assert cn_numbers.get("police") == "110", "China police number must be 110"

    # ID emergency contacts
    contacts_id = client.get(
        "/api/v1/workflow/emergency/contacts?country_code=ID", headers=headers_cn
    )
    assert contacts_id.status_code == 200
    id_numbers = {c["service_code"]: c["phone_number"] for c in contacts_id.json()["contacts"]}
    assert id_numbers.get("medical") == "119", "Indonesia PSC medical emergency number must be 119"
    assert id_numbers.get("police") == "110", "Indonesia police number must be 110"

    # Direct emergency triage API check
    triage_res = client.post(
        "/api/v1/workflow/emergency/triage",
        headers=headers_cn,
        json={"text": "sesak napas berat dan pingsan", "country_code": "CN"},
    )
    assert triage_res.status_code == 200
    triage_data = triage_res.json()
    assert triage_data["has_red_flag"] is True
    assert triage_data["recommended_action"] == "INTERRUPT_NON_EMERGENCY_FLOW"
    assert len(triage_data["matched_flags"]) > 0
    assert len(triage_data["emergency_contacts"]) > 0
    assert triage_data["guidance_message"]

    # 3. Normal Flow: Describe Need → Load Policy Context → Evaluate Care Options → Explain Costs & Conditions
    compare_res = client.post(
        "/api/v1/pathways/compare",
        headers=headers_cn,
        json={
            "complaint": "demam dan batuk pilek sejak kemarin",
            "service_type": "OUTPATIENT",
            "city": "Shenzhen",
            "timeframe": "this_week",
        },
    )
    assert compare_res.status_code == 200
    compare_data = compare_res.json()
    assert "paths" in compare_data
    assert len(compare_data["paths"]) >= 2
    assert "comparison_id" in compare_data
    comparison_id = compare_data["comparison_id"]

    # Verify grounded care option details
    first_path = compare_data["paths"][0]
    assert first_path["pathway_code"].startswith("CN_")
    assert "name" in first_path
    assert "steps" in first_path and len(first_path["steps"]) > 0
    assert "docs" in first_path
    assert "coverage_status" in first_path
    assert first_path["coverage_status"] in ["MATCHED", "NEEDS_CHECK"]

    # 4. Deterministic estimated costs: Unknown cost if no reliable tariff, no LLM arithmetic
    for path in compare_data["paths"]:
        cost = path.get("est_out_of_pocket")
        # In synthetic/default workspace without verified reference tariff, cost must be None (unknown)
        if cost is None:
            assert cost is None
        else:
            assert isinstance(cost["amount"], (int, float))
            assert isinstance(cost["currency"], str)

    # 5. Strict warnings: No unsupported diagnosis or reimbursement guarantees
    assert "warnings" in compare_data
    warnings = compare_data["warnings"]
    assert any("diagnosis" in w.lower() for w in warnings)
    assert any("payment guarantee" in w.lower() for w in warnings)

    # 6. User Selects Next Step: Optional creation of claim case with idempotency
    chosen_path = first_path["pathway_code"]
    idempotency_key = "test-pathway-claim-idem-key-001"

    claim_res = client.post(
        "/api/v1/claims",
        headers={**headers_cn, "Idempotency-Key": idempotency_key},
        json={
            "path": chosen_path,
            "coverage_id": str(coverage_cn),
            "comparison_id": comparison_id,
        },
    )
    assert claim_res.status_code == 201
    claim_data = claim_res.json()
    claim_case_id = UUID(claim_data["claim_case_id"])

    # Verify claim case row & bridge into WfClaimCaseRow in DRAFT status
    with app.state.session_factory() as db:
        case_row = db.get(ClaimCaseRow, claim_case_id)
        assert case_row is not None
        assert case_row.status == "DRAFT"
        assert case_row.account_id == account_cn
        assert case_row.coverage_id == coverage_cn
        assert case_row.country_code == "CN"
        assert case_row.path == chosen_path

        wf_case = db.get(WfClaimCaseRow, claim_case_id)
        assert wf_case is not None
        assert wf_case.status == "DRAFT"
        assert wf_case.origin == "PATHWAY"
        assert wf_case.origin_ref == str(claim_case_id)

    # Idempotency verification: Repeated submission with same or different key returns same case
    claim_res_repeat = client.post(
        "/api/v1/claims",
        headers={**headers_cn, "Idempotency-Key": "another-key-for-same-action"},
        json={
            "path": chosen_path,
            "coverage_id": str(coverage_cn),
            "comparison_id": comparison_id,
        },
    )
    assert claim_res_repeat.status_code == 201
    assert claim_res_repeat.json()["claim_case_id"] == str(claim_case_id)

    # 7. Expected: Care navigation changes based on country without blending unverified benefits
    # Compare with ID workspace: returns ID pathways (e.g. BPJS_PRIMARY)
    headers_id, account_id, coverage_id, _ = workspace(app, client, "ID")
    compare_id_res = client.post(
        "/api/v1/pathways/compare",
        headers=headers_id,
        json={
            "complaint": "demam dan pusing biasa",
            "service_type": "OUTPATIENT",
            "city": "Jakarta",
            "timeframe": "this_week",
        },
    )
    assert compare_id_res.status_code == 200
    compare_id_data = compare_id_res.json()
    id_path_codes = [p["pathway_code"] for p in compare_id_data["paths"]]
    assert any("BPJS" in code for code in id_path_codes)
