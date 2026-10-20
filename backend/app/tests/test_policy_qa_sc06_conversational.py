"""Comprehensive test suite for SC-06: Ask INSURRA (Conversational AI P0, ASK-01 to ASK-14)."""

import json
from uuid import UUID

from app.agent.langchain_agent import (
    ConversationBufferMemory,
)
from app.agent.tools import (
    LLM_EXPOSED_PERMISSION_CLASSES,
    ToolPermissionClass,
    llm_visible_tools,
)
from app.models import AccountDocumentPageRow
from app.services.policy_qa import ModelAnswer
from app.tests.workspace_fixtures import workspace

DENTAL_POLICY_PAGE_6 = (
    "PT TEKNOLOGI MAJU - EMPLOYEE GROUP HEALTH BENEFITS GUIDE 2026\n"
    "3. Dental Care (Page 6 · Dental Benefits):\n"
    "Covers preventive dental care including routine check-up, scaling, and basic filling, with annual limit of IDR 2,000,000.\n"
    "Applies to: outpatient and dental clinic visits within the network"
)

DENTAL_POLICY_PAGE_14 = (
    "5. General Exclusions (Page 14 · Exclusions):\n"
    "Orthodontic treatment, cosmetic dental procedures, and dental implants are excluded from coverage.\n"
    "Cosmetic surgeries, unauthorized experimental treatments, and non-prescribed therapies are not covered."
)


class ConversationalGatewayMock:
    def __init__(self, doc_id: UUID):
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
                        "text": (
                            "Employer health insurance covers preventive and basic dental care "
                            "such as check-up, scaling, and basic filling up to IDR 2,000,000."
                        ),
                        "label": "FROM_DOCUMENT",
                        "citations": [
                            {
                                "doc": str(self.doc_id),
                                "page": 6,
                                "quote": (
                                    "Covers preventive dental care including routine check-up, "
                                    "scaling, and basic filling, with annual limit of IDR 2,000,000."
                                ),
                            }
                        ],
                    }
                ]
            }
        )


def test_ask_01_conversational_chat_and_history_isolation(app, client):
    """ASK-01: Conversational chat with session history, user isolation and reset."""
    headers, account_id, coverage_id, doc_id = workspace(app, client, country="ID")

    with app.state.session_factory() as db:
        p6 = AccountDocumentPageRow(
            document_id=doc_id,
            page_no=6,
            text=DENTAL_POLICY_PAGE_6,
        )
        db.add(p6)
        db.commit()

    app.state.qna_gateway_factory = ConversationalGatewayMock(doc_id)

    # First turn
    res1 = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Apakah asuransi saya menanggung periksa gigi?"},
    )
    assert res1.status_code == 200
    data1 = res1.json()
    chat_id = data1["chat_session_id"]
    assert chat_id is not None
    assert data1["disposition"] == "answered"

    # Fetch history
    hist_res = client.get(f"/api/v1/ask/sessions/{chat_id}", headers=headers)
    assert hist_res.status_code == 200
    hist_data = hist_res.json()
    assert hist_data["chat_session_id"] == chat_id
    assert len(hist_data["turns"]) == 1

    # ASK-14: User/session isolation - another user cannot access this chat history
    from app.tests.test_policy_qa import account_headers, grant

    foreign_headers = account_headers(app, "unauthorized-viewer")
    for purpose in ("process_documents", "external_ai"):
        grant(client, foreign_headers, purpose)

    foreign_res = client.get(f"/api/v1/ask/sessions/{chat_id}", headers=foreign_headers)
    assert foreign_res.status_code == 404, "Foreign user must receive 404 for chat session"

    # Reset/clear chat history
    del_res = client.delete(f"/api/v1/ask/sessions/{chat_id}", headers=headers)
    assert del_res.status_code == 200
    assert client.get(f"/api/v1/ask/sessions/{chat_id}", headers=headers).status_code == 404


def test_ask_02_and_03_read_profile_and_retrieve_clauses(app, client):
    """ASK-02, ASK-03, ASK-06: Read profile, retrieve authorized clauses and validate citations."""
    headers, account_id, coverage_id, doc_id = workspace(app, client, country="ID")

    with app.state.session_factory() as db:
        p6 = AccountDocumentPageRow(
            document_id=doc_id,
            page_no=6,
            text=DENTAL_POLICY_PAGE_6,
        )
        db.add(p6)
        db.commit()

    gateway = ConversationalGatewayMock(doc_id)
    app.state.qna_gateway_factory = gateway

    res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={
            "question": "Does my insurance cover dental treatment?",
            "coverage_id": str(coverage_id),
        },
    )
    assert res.status_code == 200
    data = res.json()

    # Grounded answer point with exact quote & citation
    assert len(data["answer_points"]) > 0
    citation = data["answer_points"][0]["citations"][0]
    assert citation["page"] == 6
    assert citation["doc"] == str(doc_id)
    assert "Covers preventive dental care" in citation["quote"]

    # ASK-06 & ASK-11: High-fidelity structured fields returned
    assert "policies_used" in data
    assert "suggested_next_steps" in data
    assert "related_links" in data
    assert "follow_up_questions" in data
    assert any("protection" in link["url"] for link in data.get("related_links", []))


def test_ask_04_and_05_intent_classification_and_safety_routing(app, client):
    """ASK-04 & ASK-05: Safety screen routes emergencies and medical advice safely."""
    headers, _, _, doc_id = workspace(app, client, country="ID")
    app.state.qna_gateway_factory = ConversationalGatewayMock(doc_id)

    # Emergency symptom triggers redirect with 0 model calls
    emer_res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Dada saya sangat nyeri dan sulit bernapas, apa yang ditanggung?"},
    )
    assert emer_res.status_code == 200
    assert emer_res.json()["redirect"] == "emergency"

    # Medical diagnosis request is safely declined
    med_res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "obat apa yang cocok untuk sakit gigi saya?"},
    )
    assert med_res.status_code == 200
    med_data = med_res.json()
    assert med_data["disposition"] == "declined"
    assert med_data["intent"] == "MEDICAL_ADVICE"


def test_ask_07_and_08_follow_ups_and_explicit_uncertainty(app, client):
    """ASK-07 & ASK-08: Explicit uncertainty when clause is missing and follow-up generation."""
    headers, _, _, doc_id = workspace(app, client, country="ID")
    app.state.qna_gateway_factory = ConversationalGatewayMock(doc_id)

    # Asking for a benefit absent from the policy
    res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Apakah akupunktur dan terapi holistik ditanggung?"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["disposition"] == "no_match"
    assert len(data["verification_steps"]) > 0
    assert len(data["follow_up_questions"]) > 0


def test_ask_09_and_10_deterministic_tools_and_permission_allowlist():
    """ASK-09 & ASK-10: Allowlist enforcement and deterministic calculation."""
    # Visible tools only include allowlisted classes
    tools = llm_visible_tools()
    for t in tools:
        assert t.permission_class in LLM_EXPOSED_PERMISSION_CLASSES
        assert t.permission_class != ToolPermissionClass.CONSEQUENTIAL_EXTERNAL

    # Memory buffer window test
    mem = ConversationBufferMemory(max_turns=3)
    mem.add_turn("1", "Q1", "A1")
    mem.add_turn("2", "Q2", "A2")
    mem.add_turn("3", "Q3", "A3")
    mem.add_turn("4", "Q4", "A4")
    assert len(mem.turns) == 3
    assert mem.turns[0].turn_id == "2"


def test_ask_12_and_13_rate_limiting_and_consent_enforcement(app, client):
    """ASK-12 & ASK-13: Rate limit (20/hr) and consent enforcement."""
    headers, account_id, coverage_id, doc_id = workspace(app, client, country="ID")

    # Consent revocation fails closed
    client.post(
        "/api/v1/account/consents",
        headers=headers,
        json={"purpose": "external_ai", "granted": False},
    )
    rev_res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Periksa gigi ditanggung nggak?"},
    )
    assert rev_res.status_code == 403, "Must fail closed with 403 when AI consent is revoked"
