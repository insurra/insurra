"""Cross-language Mandarin policy retrieval and citation tests (B2.5, B2.6)."""

import json
from uuid import UUID

from sqlalchemy import select

from app.models import AccountDocumentPageRow, ClauseChunkRow
from app.services.policy_qa import ModelAnswer
from app.tests.workspace_fixtures import workspace

MANDARIN_CLAUSE = (
    "第一条 门诊医疗保障（合成演示条款）：被保险人在保险期间内于指定医疗机构接受普通门诊治疗的，"
    "需先核实医院网络及报销要求，凭正式医疗电子票据（发票）及病历申请理赔审核。"
)


class MandarinGatewayFixture:
    def __init__(self, doc_id, quote=MANDARIN_CLAUSE):
        self.doc_id = doc_id
        self.quote = quote
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
                            "Rawat jalan umum di fasilitas medis yang ditunjuk memerlukan "
                            "verifikasi jaringan rumah sakit dan fapiao medis resmi."
                        ),
                        "label": "NEEDS_CONFIRMATION",
                        "citations": [
                            {
                                "doc": str(self.doc_id),
                                "page": 1,
                                "quote": self.quote,
                            }
                        ],
                    }
                ]
            }
        )


def test_account_indonesian_question_retrieves_mandarin_clause_and_records_zh_chunk(app, client):
    headers, account_id, coverage_id, doc_id = workspace(app, client, country="CN")
    with app.state.session_factory() as db:
        page = db.scalar(
            select(AccountDocumentPageRow).where(AccountDocumentPageRow.document_id == doc_id)
        )
        page.text = (
            "合成学生健康保险条款（仅用于测试）\n"
            f"{MANDARIN_CLAUSE}\n"
            "第二条 住院医疗保障（合成演示条款）：住院治疗需提前确认直付或事后报销流程。"
        )
        db.commit()

    gateway = MandarinGatewayFixture(doc_id)
    app.state.qna_gateway_factory = gateway

    res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={
            "question": "Apakah rawat jalan ditanggung polis saya?",
            "coverage_id": str(coverage_id),
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["disposition"] == "answered"
    assert body["intent"] == "POLICY_QUESTION"
    assert len(body["answer_points"]) == 1
    citation = body["answer_points"][0]["citations"][0]
    assert citation["quote"] == MANDARIN_CLAUSE
    assert citation["language"] == "zh"
    assert citation["explanation_label"] == "Explanation, not a translation of the clause"

    with app.state.session_factory() as db:
        chunks = list(
            db.scalars(select(ClauseChunkRow).where(ClauseChunkRow.account_id == account_id))
        )
        assert chunks
        assert all(c.language == "zh" for c in chunks)


def test_raka_demo_cross_language_qa_and_chinese_red_flag(app, client, demo):
    _, headers = demo("raka")
    for purpose in ("process_documents", "external_ai", "retention"):
        assert (
            client.post(
                "/api/v1/consents", headers=headers, json={"purpose": purpose, "granted": True}
            ).status_code
            == 200
        )

    record = client.get("/api/v1/insurance/record", headers=headers).json()
    policy = record["policies"][0]
    doc_id = UUID(policy["source_document_ids"][0])

    gateway = MandarinGatewayFixture(doc_id)
    app.state.qna_gateway_factory = gateway

    res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Apakah rawat jalan ditanggung polis saya?"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["disposition"] == "answered"
    citation = body["answer_points"][0]["citations"][0]
    assert citation["quote"] == MANDARIN_CLAUSE
    assert citation["language"] == "zh"
    assert citation["explanation_label"] == "Explanation, not a translation of the clause"
    assert citation["document_name"] == "student-insurance-certificate-synthetic.txt"

    source_res = client.get(f"/api/v1/ask/sources/{doc_id}/1", headers=headers)
    assert source_res.status_code == 200
    assert MANDARIN_CLAUSE in source_res.json()["text"]

    # Chinese red-flag phrase redirects to emergency without calling the AI provider
    calls_before = len(gateway.calls)
    red_flag_res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "我今天胸痛而且呼吸困难"},
    )
    assert red_flag_res.status_code == 200
    assert red_flag_res.json() == {"redirect": "emergency"}
    assert len(gateway.calls) == calls_before

    # Revoking external_ai blocks Ask
    grant_res = client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "external_ai", "granted": False},
    )
    assert grant_res.status_code == 200
    assert (
        client.post(
            "/api/v1/ask",
            headers=headers,
            json={"question": "Apakah rawat jalan ditanggung polis saya?"},
        ).status_code
        == 403
    )
