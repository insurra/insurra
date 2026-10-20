"""Opt-in, real-provider workflow check. Only synthetic policy text is submitted."""

import json
import os
from uuid import UUID

import pytest
from sqlalchemy import select

from app.core.config import Settings
from app.models import ClauseChunkRow
from app.services.ai_gateway import GeminiGateway
from app.tests.test_account_workspace import account_headers, grant, profile_payload
from app.tests.workspace_fixtures import reviewed_triage


def synthetic_policy_pdf() -> bytes:
    lines = [
        "FICTIONAL TEST POLICY. Not real insurance.",
        "Provider: Northstar Synthetic Insurance.",
        "Coverage start date: 2026-01-01.",
        "Coverage end date: 2027-12-31.",
        "General dental treatment is excluded under this fictional policy.",
    ]
    commands = ["BT", "/F1 12 Tf", "50 750 Td", "15 TL"]
    for line in lines:
        escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.extend([f"({escaped}) Tj", "T*"])
    commands.append("ET")
    stream = "\n".join(commands).encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
        ),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode())
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")
    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(offsets)}\n".encode())
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode())
    trailer = f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
    pdf.extend(trailer.encode())
    return bytes(pdf)


def test_live_gemini_auth_upload_extraction_citations_and_no_match(app, client, monkeypatch):
    if os.environ.get("INSURRA_LIVE_GEMINI") != "1":
        pytest.skip("Set INSURRA_LIVE_GEMINI=1 to send synthetic content to Gemini.")
    configured = Settings()
    if not configured.gemini_api_key.get_secret_value():
        pytest.skip("GEMINI_API_KEY is not configured.")

    app.state.settings = app.state.settings.model_copy(
        update={
            "gemini_api_key": configured.gemini_api_key,
            "gemini_model": configured.gemini_model,
            "gemini_fast_model": configured.gemini_fast_model,
        }
    )
    reviewed_triage(app, monkeypatch)

    calls = []
    original_parse = GeminiGateway.parse

    def counted_parse(gateway, **kwargs):
        calls.append(kwargs["output_type"].__name__)
        return original_parse(gateway, **kwargs)

    monkeypatch.setattr(GeminiGateway, "parse", counted_parse)
    headers = account_headers(app, "live-gemini")
    assert (
        client.put("/api/v1/account/profile", headers=headers, json=profile_payload()).status_code
        == 200
    )
    for purpose in ("process_documents", "external_ai", "retention"):
        grant(client, headers, purpose)

    uploaded = client.post(
        "/api/v1/account/documents",
        headers=headers,
        files={"file": ("fictional-policy.pdf", synthetic_policy_pdf(), "application/pdf")},
        data={"kind": "policy_booklet"},
    )
    assert uploaded.status_code == 201
    document_id = uploaded.json()["document_id"]
    detail = client.get(f"/api/v1/account/documents/{document_id}", headers=headers).json()
    assert detail["status"] == "COMPLETED", detail["error_code"]
    assert detail["pages"] and detail["pages"][0]["page_no"] == 1
    assert detail["fields"]
    assert all(field["status"] == "UNVERIFIED" for field in detail["fields"])
    assert calls == ["ExtractionResult"]

    supported = client.post(
        "/api/v1/ask",
        headers={**headers, "Accept": "text/event-stream"},
        json={"question": "Does the fictional policy exclude general dental treatment?"},
    )
    assert supported.status_code == 200
    events = [
        json.loads(frame.split("data: ", 1)[1])
        for frame in supported.text.split("\n\n")
        if frame.startswith("event:")
    ]
    event_names = [event["event"] for event in events]
    assert event_names[:2] == ["progress", "progress"]
    assert event_names[-1] == "complete"
    assert event_names[2:-1] and set(event_names[2:-1]) == {"answer_point"}
    answer = events[-1]["data"]
    assert answer["answer_points"]
    citation = answer["answer_points"][0]["citations"][0]
    assert citation["doc"] == document_id and citation["page"] == 1
    assert citation["quote"] in detail["pages"][0]["text"]
    with app.state.session_factory() as db:
        chunks = list(
            db.scalars(
                select(ClauseChunkRow).where(ClauseChunkRow.document_id == UUID(document_id))
            )
        )
    assert chunks and all(chunk.text_sha256 for chunk in chunks)
    assert not hasattr(chunks[0], "text")
    assert calls == ["ExtractionResult", "ModelAnswer"]

    unsupported = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Does the policy cover fertility services?"},
    )
    assert unsupported.status_code == 200
    assert unsupported.json()["disposition"] == "no_match"
    assert unsupported.json()["answer_points"] == []
    assert calls == ["ExtractionResult", "ModelAnswer"]
