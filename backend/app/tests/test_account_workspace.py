"""Authenticated workspace must stay isolated from other accounts and demo sessions."""

import hashlib
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.models import AccountRow, AccountSessionRow
from app.services.account_documents import CandidateField, ExtractionResult, PageText


def account_headers(app, suffix: str) -> dict[str, str]:
    now = datetime.now(UTC)
    token = f"synthetic-account-token-{suffix}"
    with app.state.session_factory() as db:
        account = AccountRow(
            id=uuid4(),
            email=f"{suffix}_{uuid4().hex[:8]}@example.test",
            display_name=suffix,
            avatar_url=None,
            email_verified=True,
            created_at=now,
            updated_at=now,
        )
        db.add(account)
        db.add(
            AccountSessionRow(
                id=uuid4(),
                account_id=account.id,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                created_at=now,
                expires_at=now + timedelta(hours=1),
                revoked_at=None,
            )
        )
        db.commit()
    return {"Authorization": f"Bearer {token}"}


def profile_payload() -> dict:
    return {
        "display_name": "Rere",
        "residence_context": "ABROAD",
        "country_code": "AU",
        "occupation": "STUDENT",
        "city": "Sydney",
        "arrival_date": "2026-10-01",
        "visa_expiry_date": "2027-10-01",
    }


def grant(client, headers, purpose: str, granted: bool = True):
    response = client.post(
        "/api/v1/account/consents",
        headers=headers,
        json={"purpose": purpose, "granted": granted, "policy_version": "1.5"},
    )
    assert response.status_code == 200, response.text


def test_account_profile_and_consent_are_separate_from_demo(app, client, demo):
    mine = account_headers(app, "rere")
    other = account_headers(app, "other")
    assert client.get("/api/v1/account/profile", headers=mine).json()["completed"] is False
    assert (
        client.get("/api/v1/account/consents", headers=mine).json()["mandatory_complete"] is False
    )
    assert (
        client.put("/api/v1/account/profile", headers=mine, json=profile_payload()).status_code
        == 200
    )
    assert client.get("/api/v1/account/profile", headers=other).json()["completed"] is False
    demo_session, demo_headers = demo()
    assert demo_session["session_token"]
    assert client.get("/api/v1/account/profile", headers=demo_headers).status_code == 401
    assert client.get("/api/v1/profile", headers=mine).status_code == 401


def test_document_scope_consent_review_and_retention_revocation(app, client, monkeypatch):
    mine = account_headers(app, "uploader")
    other = account_headers(app, "outsider")
    assert (
        client.put("/api/v1/account/profile", headers=mine, json=profile_payload()).status_code
        == 200
    )
    monkeypatch.setattr(
        "app.api.v1.account_documents.extract_text_or_ocr",
        lambda content, mime: [
            PageText(page_no=1, text="Coverage start: 2026-10-01", ocr_used=False)
        ],
    )
    monkeypatch.setattr(
        "app.api.v1.account_documents.extract_to_schema",
        lambda pages, country, kind, settings: ExtractionResult(
            fields=[
                CandidateField(field_key="coverage_start_date", value="2026-10-01", source_page=1)
            ]
        ),
    )

    def upload():
        return client.post(
            "/api/v1/account/documents",
            headers=mine,
            files={"file": ("policy.pdf", b"%PDF-synthetic", "application/pdf")},
            data={"kind": "policy_booklet"},
        )

    blocked = upload()
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "CONSENT_REQUIRED"
    assert blocked.json()["details"]["required_purposes"] == ["process_documents", "external_ai"]
    grant(client, mine, "process_documents")
    assert upload().status_code == 403
    grant(client, mine, "external_ai")
    grant(client, mine, "retention")
    response = upload()
    assert response.status_code == 201, response.text
    document_id = response.json()["document_id"]
    assert client.get(f"/api/v1/account/documents/{document_id}", headers=other).status_code == 404
    assert client.get(f"/api/v1/account/documents/{uuid4()}", headers=other).status_code == 404
    detail = client.get(f"/api/v1/account/documents/{document_id}", headers=mine).json()
    assert detail["original_file_status"] == "RETAINED"
    assert detail["fields"][0]["status"] == "UNVERIFIED"
    field_id = detail["fields"][0]["id"]
    assert (
        client.patch(
            f"/api/v1/account/fields/{field_id}",
            headers=other,
            json={"value": "2026-10-01", "confirm": True},
        ).status_code
        == 404
    )
    reviewed = client.patch(
        f"/api/v1/account/fields/{field_id}",
        headers=mine,
        json={"value": "2026-10-02", "confirm": True},
    )
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["previous_value"] == "2026-10-01"
    grant(client, mine, "retention", False)
    assert (
        client.get(f"/api/v1/account/documents/{document_id}/file", headers=mine).status_code == 404
    )
    assert (
        client.get(f"/api/v1/account/documents/{document_id}", headers=mine).json()[
            "original_file_status"
        ]
        == "DELETED"
    )
    grant(client, mine, "process_documents", False)
    assert upload().status_code == 403


def test_completeness_validates_dates_and_privacy_delete(app, client):
    mine = account_headers(app, "checker")
    assert (
        client.put("/api/v1/account/profile", headers=mine, json=profile_payload()).status_code
        == 200
    )
    invalid = client.post(
        "/api/v1/account/manual-fields",
        headers=mine,
        json={"field_key": "coverage_start_date", "value": "not-a-date", "confirm": True},
    )
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "INVALID_DATE"
    assert (
        client.post(
            "/api/v1/account/manual-fields",
            headers=mine,
            json={"field_key": "coverage_start_date", "value": "2026-10-05", "confirm": True},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/account/manual-fields",
            headers=mine,
            json={"field_key": "coverage_end_date", "value": "2027-10-01", "confirm": True},
        ).status_code
        == 200
    )
    response = client.get("/api/v1/account/completeness?task=visa_cover", headers=mine)
    assert response.status_code == 200, response.text
    assert response.json()["visa_gap"]["gap_days"] == 4
    assert (
        client.request(
            "DELETE", "/api/v1/account/data", headers=mine, json={"confirm": "NO"}
        ).status_code
        == 422
    )
    assert (
        client.request(
            "DELETE", "/api/v1/account/data", headers=mine, json={"confirm": "HAPUS"}
        ).status_code
        == 200
    )
    assert client.get("/api/v1/account/profile", headers=mine).json()["completed"] is False
    assert (
        client.get("/api/v1/account/consents", headers=mine).json()["mandatory_complete"] is False
    )


def test_policy_wallet_and_family_management(app, client):
    mine = account_headers(app, "family_owner")
    other = account_headers(app, "family_other")
    assert (
        client.put("/api/v1/account/profile", headers=mine, json=profile_payload()).status_code
        == 200
    )

    # Family creation
    res = client.post(
        "/api/v1/account/family",
        headers=mine,
        json={
            "name": "Sinta",
            "relation": "Spouse",
            "birth_date": "1998-05-12",
            "consent_confirmed": True,
        },
    )
    assert res.status_code == 201, res.text
    member_id = res.json()["id"]

    # Listing family
    my_family = client.get("/api/v1/account/family", headers=mine).json()
    assert len(my_family) == 1
    assert my_family[0]["name"] == "Sinta"
    assert my_family[0]["relation"] == "Spouse"

    # Isolation check: other account cannot see family member
    other_family = client.get("/api/v1/account/family", headers=other).json()
    assert len(other_family) == 0
    assert client.delete(f"/api/v1/account/family/{member_id}", headers=other).status_code == 404

    # Deleting family member
    del_res = client.delete(f"/api/v1/account/family/{member_id}", headers=mine)
    assert del_res.status_code == 200
    assert len(client.get("/api/v1/account/family", headers=mine).json()) == 0

    # Policy wallet checks
    policies = client.get("/api/v1/account/policies", headers=mine).json()
    assert isinstance(policies, list)


def test_audit_timeline_masking_tools_and_rls_isolation(app, client, demo):
    from app.services.audit_logger import log_account_event, log_event

    mine = account_headers(app, "audit_user_a")
    other = account_headers(app, "audit_user_b")

    # Trigger account events
    assert (
        client.put("/api/v1/account/profile", headers=mine, json=profile_payload()).status_code
        == 200
    )

    # Also log an answer event with policy number in summary and verify masking + tools
    me_id = client.get("/api/v1/auth/me", headers=mine).json()["id"]
    from uuid import UUID

    with app.state.session_factory() as db:
        log_account_event(
            db,
            UUID(me_id),
            "ANSWER_GENERATED",
            category="answer",
            source_screen="SC-06 · Tanya Polis",
            input_summary="Pertanyaan manfaat rawat inap untuk polis POL-9876541234",
            tools_called=["retrieve_clause", "rules_engine", "unknown_injected_tool"],
            result_summary="Klausul manfaat ditemukan pada kartu 000188885678",
            reason="Menjawab berdasarkan bukti klausul polis dan perhitungan rules engine.",
            raw_document_text="PRIVATE_DOC_CONTENT_NEVER_SHOWN",
            system_prompt="SECRET_SYSTEM_PROMPT_NEVER_SHOWN",
        )
        db.commit()

    res_a = client.get("/api/v1/account/audit?limit=20&offset=0", headers=mine)
    assert res_a.status_code == 200
    events_a = res_a.json()
    assert int(res_a.headers["X-Total-Count"]) >= 2

    answer_events = [e for e in events_a if e["event_type"] == "ANSWER_GENERATED"]
    assert len(answer_events) == 1
    ans = answer_events[0]
    assert ans["category"] == "answer"
    assert ans["source_screen"] == "SC-06 · Tanya Polis"
    assert ans["tools_called"] == ["retrieve_clause", "rules_engine"]
    assert "****1234" in ans["input_summary"]
    assert "9876541234" not in ans["input_summary"]
    assert "****5678" in ans["result_summary"]
    assert "000188885678" not in ans["result_summary"]
    assert "PRIVATE_DOC_CONTENT_NEVER_SHOWN" not in str(ans)
    assert "SECRET_SYSTEM_PROMPT_NEVER_SHOWN" not in str(ans)

    # Detail endpoint & RLS check: User A can view own detail, User B gets 404
    detail_a = client.get(f"/api/v1/account/audit/{ans['id']}", headers=mine)
    assert detail_a.status_code == 200
    assert detail_a.json()["id"] == ans["id"]
    assert client.get(f"/api/v1/account/audit/{ans['id']}", headers=other).status_code == 404
    assert client.get("/api/v1/account/audit", headers=other).json() == []

    # Category filter works for account audit
    filtered_ans = client.get("/api/v1/account/audit?type=answer", headers=mine).json()
    assert any(e["id"] == ans["id"] for e in filtered_ans)

    # Demo session audit enrichment & detail RLS
    session_a, headers_a = demo("raka")
    _, headers_b = demo("sinta")
    with app.state.session_factory() as db:
        log_event(
            db,
            UUID(session_a["id"]),
            "ANSWER",
            input_summary="Cek manfaat polis OSHC-5566771234",
            tools_called=["retrieve_clause", "rules_engine"],
            result_summary="Manfaat ditemukan untuk ****1234",
        )
        db.commit()

    demo_ans = client.get("/api/v1/audit?type=answer", headers=headers_a).json()
    assert len(demo_ans) >= 1
    first_ans = demo_ans[0]
    assert first_ans["category"] == "answer"
    assert first_ans["tools_called"] == ["retrieve_clause", "rules_engine"]
    assert "****1234" in first_ans["input_summary"]
    assert "5566771234" not in first_ans["input_summary"]
    assert client.get(f"/api/v1/audit/{first_ans['id']}", headers=headers_a).status_code == 200
    assert client.get(f"/api/v1/audit/{first_ans['id']}", headers=headers_b).status_code == 404


def test_guardrail_highlight_subtypes_and_demo_scenario(client, demo):
    _, headers = demo("raka")
    # Trigger emergency ("nyeri dada") via triage before opening guardrail view
    assert (
        client.post("/api/v1/triage", headers=headers, json={"text": "nyeri dada"}).status_code
        == 501
    )

    # Opening /api/v1/audit?type=guardrail in demo returns >= 3 distinct guardrail subtypes
    res = client.get("/api/v1/audit?type=guardrail", headers=headers)
    assert res.status_code == 200
    guardrail_events = res.json()
    assert int(res.headers["X-Total-Count"]) == len(guardrail_events)
    assert len(guardrail_events) >= 3

    expected_subtypes = {
        "Instruksi di dokumen diabaikan",
        "Tanda bahaya → arahan darurat",
        "Jawaban tanpa sumber ditolak",
    }
    found_subtypes = {e["subtype"] for e in guardrail_events}
    assert expected_subtypes.issubset(found_subtypes)
    assert all(e["category"] == "guardrail" and e["subtype"] for e in guardrail_events)
    assert all("8899001234" not in (e["input_summary"] or "") for e in guardrail_events)
