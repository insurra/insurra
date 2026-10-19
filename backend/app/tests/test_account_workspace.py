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


def test_action_approve_edit_reject_l2_and_unapproved_guardrail(client, demo):
    from app.services.approval import payload_sha256

    _, headers = demo("raka")
    assert (
        client.put(
            "/api/v1/consent", headers=headers, json={"processing_consent": True}
        ).status_code
        == 200
    )

    actions_res = client.get("/api/v1/actions?seed_demo=true", headers=headers)
    assert actions_res.status_code == 200
    actions_list = actions_res.json()
    assert len(actions_list) == 3

    l2_action = next(a for a in actions_list if a["permission_level"] == "L2")
    l1_edit_action = next(a for a in actions_list if a["action_type"] == "draft_message")
    l1_reject_action = next(a for a in actions_list if a["action_type"] == "create_reminder")

    # 1. Execute PENDING action -> 403 and logs GUARDRAIL_UNAPPROVED_ACTION in SC-11
    exec_pending = client.post(
        f"/api/v1/actions/{l2_action['id']}/execute",
        headers=headers,
        json={"approved_payload_sha256": "a" * 64},
    )
    assert exec_pending.status_code == 403
    assert exec_pending.json()["code"] == "ACTION_APPROVAL_REQUIRED"

    audit_after_unapproved = client.get("/api/v1/audit", headers=headers).json()
    assert any(
        e["event_type"] == "GUARDRAIL_UNAPPROVED_ACTION"
        and e["subtype"] == "Tindakan tanpa persetujuan diblokir"
        for e in audit_after_unapproved
    )

    # 2. L2 action requires confirmed=True; confirmed=False is rejected (422)
    l2_unconfirmed = client.post(
        f"/api/v1/actions/{l2_action['id']}/approve",
        headers=headers,
        json={"confirmed": False},
    )
    assert l2_unconfirmed.status_code == 422
    assert l2_unconfirmed.json()["code"] == "L2_CONFIRMATION_REQUIRED"

    l2_confirmed = client.post(
        f"/api/v1/actions/{l2_action['id']}/approve",
        headers=headers,
        json={"confirmed": True},
    )
    assert l2_confirmed.status_code == 200
    assert l2_confirmed.json()["status"] == "APPROVED"

    # Once APPROVED, cannot edit or approve again (409)
    assert (
        client.post(
            f"/api/v1/actions/{l2_action['id']}/approve",
            headers=headers,
            json={"edited_payload": {"message": "Ubah setelah setuju"}, "confirmed": True},
        ).status_code
        == 409
    )

    # 3. Edit message then approve -> edited payload hash is bound and audit logs the edit
    edited_payload = {
        **(l1_edit_action["payload"] or {}),
        "message": "Pesan telah diubah oleh pengguna sebelum disetujui.",
    }
    edit_approve = client.post(
        f"/api/v1/actions/{l1_edit_action['id']}/approve",
        headers=headers,
        json={"edited_payload": edited_payload, "confirmed": True},
    )
    assert edit_approve.status_code == 200
    assert edit_approve.json()["status"] == "APPROVED"

    updated_detail = client.get(f"/api/v1/actions/{l1_edit_action['id']}", headers=headers).json()
    expected_hash = payload_sha256(edited_payload)
    assert updated_detail["approved_payload_sha256"] == expected_hash
    assert (
        updated_detail["payload"]["message"]
        == "Pesan telah diubah oleh pengguna sebelum disetujui."
    )

    # Execution with edited payload hash passes approval check and completes
    exec_edited = client.post(
        f"/api/v1/actions/{l1_edit_action['id']}/execute",
        headers=headers,
        json={"approved_payload_sha256": expected_hash},
    )
    assert exec_edited.status_code == 200
    assert exec_edited.json()["status"] == "COMPLETED"

    # 4. Reject with reason "Isi salah" -> status REJECTED and reason saved in action + audit
    reject_res = client.post(
        f"/api/v1/actions/{l1_reject_action['id']}/reject",
        headers=headers,
        json={"reason": "Isi salah"},
    )
    assert reject_res.status_code == 200
    assert reject_res.json()["status"] == "REJECTED"

    rejected_detail = client.get(
        f"/api/v1/actions/{l1_reject_action['id']}", headers=headers
    ).json()
    assert rejected_detail["status"] == "REJECTED"
    assert rejected_detail["reason"] == "Isi salah"

    action_audits = client.get("/api/v1/audit?type=action", headers=headers).json()
    assert any(e["event_type"] == "ACTION_EDITED_AND_APPROVED" for e in action_audits)
    assert any(
        e["event_type"] == "ACTION_REJECTED" and e["reason"] == "Isi salah" for e in action_audits
    )


def test_actions_queue_pending_cards_stale_masking_and_forbidden_tool_guardrail(client, demo):
    _, headers = demo("raka")
    assert (
        client.put(
            "/api/v1/consent", headers=headers, json={"processing_consent": True}
        ).status_code
        == 200
    )

    # 1. Empty queue when include_empty=true and no drafts exist yet
    empty_res = client.get("/api/v1/actions?include_empty=true", headers=headers)
    assert empty_res.status_code == 200
    assert empty_res.json() == []

    # 2. Seed 3 pending drafts -> all 3 have reason, source_screen, permission_level
    seeded_res = client.get("/api/v1/actions?seed_demo=true", headers=headers)
    assert seeded_res.status_code == 200
    seeded = seeded_res.json()
    assert len(seeded) == 3
    assert all(item["status"] == "PENDING" for item in seeded)
    for item in seeded:
        assert item["reason"]
        assert item["source_screen"]
        assert item["permission_level"] in {"L1", "L2"}
        assert "****1234" in str(item["payload"])

    # Reminder created >14 days ago is marked stale with "Mungkin sudah tidak relevan"
    reminder_card = next(item for item in seeded if item["action_type"] == "create_reminder")
    assert reminder_card["reason"] == "Dibuat karena ada jeda 76 hari antara asuransi dan visa"
    assert reminder_card["is_stale"] is True
    assert reminder_card["stale_label"] == "Mungkin sudah tidak relevan"

    # 3. Attempt to create an action with a forbidden tool type / L3 -> 403 + guardrail audit entry
    forbidden_res = client.post(
        "/api/v1/actions",
        headers=headers,
        json={
            "action_type": "auto_pay_provider",
            "permission_level": "L3",
            "reason": "Otomatis bayar tagihan RS",
            "source_screen": "SC-09 · Kesiapan Klaim",
        },
    )
    assert forbidden_res.status_code == 403
    assert forbidden_res.json()["code"] == "ACTION_TYPE_FORBIDDEN"

    guardrail_audits = client.get("/api/v1/audit", headers=headers).json()
    assert any(
        e["event_type"] == "GUARDRAIL_UNAPPROVED_ACTION"
        and e["subtype"] == "Tindakan tanpa persetujuan diblokir"
        and "auto_pay_provider" in (e["input_summary"] or "")
        for e in guardrail_audits
    )

    # 4. Propose a valid draft_claim_form with raw policy number -> server masks to ****5678
    propose_res = client.post(
        "/api/v1/actions",
        headers=headers,
        json={
            "action_type": "draft_claim_form",
            "title": "Draf formulir klaim fisioterapi",
            "reason": "Dibuat karena bukti fisioterapi telah diunggah di kesiapan klaim",
            "source_screen": "SC-09 · Kesiapan Klaim",
            "payload": {
                "policy_number": "OSHC-9988775678",
                "preview": "Draf formulir klaim untuk polis OSHC-9988775678",
                "message": "Pengajuan klaim fisioterapi polis OSHC-9988775678.",
            },
        },
    )
    assert propose_res.status_code == 201
    created = propose_res.json()
    assert created["permission_level"] == "L1"
    assert created["payload"]["policy_number"] == "****5678"
    assert "****5678" in created["preview"]
    assert "9988775678" not in created["preview"]
    assert "9988775678" not in str(created["payload"])


def test_action_execution_ics_mailto_pdf_idempotency_and_hash_guardrail(client, demo):
    _, headers = demo("raka")
    assert (
        client.put(
            "/api/v1/consent", headers=headers, json={"processing_consent": True}
        ).status_code
        == 200
    )

    actions_list = client.get("/api/v1/actions?seed_demo=true", headers=headers).json()
    reminder = next(a for a in actions_list if a["action_type"] == "create_reminder")
    message_draft = next(a for a in actions_list if a["action_type"] == "draft_message")

    # 1. Approve & execute create_reminder -> .ics downloaded with right date,
    # COMPLETED, no full policy/NIK/passport/visa
    assert (
        client.post(
            f"/api/v1/actions/{reminder['id']}/approve",
            headers=headers,
            json={"confirmed": True},
        ).status_code
        == 200
    )
    reminder_approved = client.get(f"/api/v1/actions/{reminder['id']}", headers=headers).json()
    rem_hash = reminder_approved["approved_payload_sha256"]

    # Mismatched hash is cancelled (403) and logs guardrail
    mismatch_res = client.post(
        f"/api/v1/actions/{reminder['id']}/execute",
        headers=headers,
        json={"approved_payload_sha256": "b" * 64},
    )
    assert mismatch_res.status_code == 403
    assert mismatch_res.json()["code"] == "APPROVED_PAYLOAD_MISMATCH"
    guardrails = client.get("/api/v1/audit?type=guardrail", headers=headers).json()
    assert any(
        e["event_type"] == "GUARDRAIL_UNAPPROVED_ACTION"
        and e["subtype"] == "Tindakan tanpa persetujuan diblokir"
        for e in guardrails
    )

    # First execution succeeds -> status COMPLETED, .ics has DTSTART;VALUE=DATE:20270315
    exec1 = client.post(
        f"/api/v1/actions/{reminder['id']}/execute",
        headers=headers,
        json={"approved_payload_sha256": rem_hash},
    )
    assert exec1.status_code == 200
    exec1_body = exec1.json()
    assert exec1_body["status"] == "COMPLETED"
    assert exec1_body["executed_at"] is not None
    ics_text = exec1_body["execution_result"]["ics_content"]
    assert "DTSTART;VALUE=DATE:20270315" in ics_text
    assert "****1234" in ics_text
    assert (
        "calendar.google.com/calendar/render"
        in exec1_body["execution_result"]["google_calendar_url"]
    )

    # Direct .ics download endpoint
    ics_dl = client.get(f"/api/v1/actions/{reminder['id']}/ics", headers=headers)
    assert ics_dl.status_code == 200
    assert "DTSTART;VALUE=DATE:20270315" in ics_dl.text

    # Triggering execute a second time is idempotent -> only ONE ACTION_EXECUTED
    # audit entry for this reminder
    exec2 = client.post(
        f"/api/v1/actions/{reminder['id']}/execute",
        headers=headers,
        json={"approved_payload_sha256": rem_hash},
    )
    assert exec2.status_code == 200
    assert exec2.json()["executed_at"] == exec1_body["executed_at"]
    action_audits = client.get("/api/v1/audit?type=action", headers=headers).json()
    executed_events = [e for e in action_audits if e["event_type"] == "ACTION_EXECUTED"]
    assert len(executed_events) == 1

    # 2. Approve (with edited message) & execute draft_message -> mailto has approved subject & body
    edited_msg_payload = {
        **(message_draft["payload"] or {}),
        "subject": "Konfirmasi Manfaat Klinik GP — Polis ****1234",
        "message": (
            "Halo tim layanan, mohon konfirmasi direct billing klinik GP untuk polis ****1234."
        ),
    }
    assert (
        client.post(
            f"/api/v1/actions/{message_draft['id']}/approve",
            headers=headers,
            json={"edited_payload": edited_msg_payload, "confirmed": True},
        ).status_code
        == 200
    )
    msg_approved = client.get(f"/api/v1/actions/{message_draft['id']}", headers=headers).json()
    msg_exec = client.post(
        f"/api/v1/actions/{message_draft['id']}/execute",
        headers=headers,
        json={"approved_payload_sha256": msg_approved["approved_payload_sha256"]},
    )
    assert msg_exec.status_code == 200
    mailto_url = msg_exec.json()["execution_result"]["mailto_url"]
    assert mailto_url.startswith("mailto:")
    assert "Konfirmasi%20Manfaat%20Klinik%20GP" in mailto_url
    assert "mohon%20konfirmasi%20direct%20billing" in mailto_url

    # 3. Propose draft_claim_form with sensitive IDs (full policy, NIK, passport, visa),
    # approve, simulate failure, retry -> PDF masks all sensitive IDs
    claim_form_res = client.post(
        "/api/v1/actions",
        headers=headers,
        json={
            "action_type": "draft_claim_form",
            "title": "Formulir Klaim Rawat Jalan",
            "reason": "Dibuat dari checklist kesiapan klaim",
            "source_screen": "SC-09 · Kesiapan Klaim",
            "payload": {
                "provider": "Allianz Care Australia",
                "policy_number": "OSHC-8899001234",
                "nik": "3171012345678901",
                "passport_number": "C9876543",
                "visa_grant_number": "VISA-1122334455667",
                "diagnosis_code": "J06.9",
                "claim_amount": "125.00 AUD",
                "message": "Klaim polis OSHC-8899001234 paspor C9876543 NIK 3171012345678901.",
            },
        },
    )
    assert claim_form_res.status_code == 201
    claim_form = claim_form_res.json()
    assert (
        client.post(
            f"/api/v1/actions/{claim_form['id']}/approve",
            headers=headers,
            json={"confirmed": True},
        ).status_code
        == 200
    )
    cf_approved = client.get(f"/api/v1/actions/{claim_form['id']}", headers=headers).json()
    cf_hash = cf_approved["approved_payload_sha256"]

    # Simulate failure -> status FAILED with failure_reason
    failed_exec = client.post(
        f"/api/v1/actions/{claim_form['id']}/execute?simulate_failure=true",
        headers=headers,
        json={"approved_payload_sha256": cf_hash},
    )
    assert failed_exec.status_code == 200
    assert failed_exec.json()["status"] == "FAILED"
    assert failed_exec.json()["failure_reason"]

    # Retry -> status COMPLETED and PDF download contains no full policy/NIK/passport/visa
    retry_exec = client.post(
        f"/api/v1/actions/{claim_form['id']}/execute",
        headers=headers,
        json={"approved_payload_sha256": cf_hash},
    )
    assert retry_exec.status_code == 200
    retry_body = retry_exec.json()
    assert retry_body["status"] == "COMPLETED"
    assert retry_body["execution_result"]["can_create_sandbox_submission"] is True

    pdf_res = client.get(f"/api/v1/actions/{claim_form['id']}/pdf", headers=headers)
    assert pdf_res.status_code == 200
    assert pdf_res.content.startswith(b"%PDF-1.4")
    pdf_text_raw = pdf_res.content.decode("latin-1")
    assert "8899001234" not in pdf_text_raw
    assert "3171012345678901" not in pdf_text_raw
    assert "C9876543" not in pdf_text_raw
    assert "1122334455667" not in pdf_text_raw
    assert "****1234" in pdf_text_raw


def test_us_10_04_submit_claim_to_sandbox_provider_and_export_logs(client, demo) -> None:
    _, headers = demo("raka")
    assert (
        client.put(
            "/api/v1/consent", headers=headers, json={"processing_consent": True}
        ).status_code
        == 200
    )

    # 1. Create and complete draft_claim_form first (US-10-03 prerequisite)
    cf_res = client.post(
        "/api/v1/actions",
        headers=headers,
        json={
            "action_type": "draft_claim_form",
            "title": "Formulir Klaim Rawat Jalan GP",
            "reason": "Klaim siap dikirim ke sandbox setelah dokumen lengkap",
            "source_screen": "SC-09 · Kesiapan Klaim",
            "payload": {
                "provider": "Allianz Care Australia",
                "policy_number": "OSHC-8899001234",
                "diagnosis_code": "J06.9",
                "claim_amount": "125.00 AUD",
            },
        },
    )
    assert cf_res.status_code == 201
    cf = cf_res.json()
    assert (
        client.post(
            f"/api/v1/actions/{cf['id']}/approve", headers=headers, json={"confirmed": True}
        ).status_code
        == 200
    )
    cf_approved = client.get(f"/api/v1/actions/{cf['id']}", headers=headers).json()
    cf_exec = client.post(
        f"/api/v1/actions/{cf['id']}/execute",
        headers=headers,
        json={"approved_payload_sha256": cf_approved["approved_payload_sha256"]},
    )
    assert cf_exec.status_code == 200
    assert cf_exec.json()["status"] == "COMPLETED"

    # 2. Propose claim_submit action from the completed claim_form (L2)
    sbx_action_res = client.post(
        "/api/v1/actions",
        headers=headers,
        json={
            "action_type": "claim_submit",
            "permission_level": "L2",
            "title": "Kirim klaim ke penyedia (sandbox)",
            "reason": "Dibuat dari formulir klaim yang sudah selesai dieksekusi (US-10-03)",
            "source_screen": "SC-10 · Antrean Tindakan",
            "payload": {
                "source_claim_form_action_id": cf["id"],
                "provider": "Allianz Care Australia",
                "provider_label": "Allianz Care Australia (Sandbox – bukan penyedia nyata)",
                "policy_number": "****1234",
                "diagnosis_code": "J06.9",
                "claim_amount": "125.00 AUD",
                "summary_action": "Klaim akan dikirim ke penyedia (sandbox)",
            },
        },
    )
    assert sbx_action_res.status_code == 201
    sbx_action = sbx_action_res.json()
    assert sbx_action["action_type"] == "claim_submit"
    assert sbx_action["permission_level"] == "L2"
    claim_case_id = sbx_action["payload"]["claim_case_id"]
    attachments = sbx_action["payload"]["attachments"]
    assert len(attachments) >= 1
    assert all("document_id" in a and len(a["sha256"]) == 64 for a in attachments)

    # 3. AC: Unapproved submission -> 403 and guardrail audit event
    unapproved_sub = client.post(
        "/api/v1/sandbox/insurer/claims",
        headers=headers,
        json={
            "action_id": sbx_action["id"],
            "claim_case_id": claim_case_id,
            "approved_payload_sha256": "0" * 64,
            "attachments": [
                {"document_id": a["document_id"], "sha256": a["sha256"]} for a in attachments
            ],
        },
    )
    assert unapproved_sub.status_code == 403
    assert unapproved_sub.json()["code"] == "ACTION_APPROVAL_REQUIRED"
    guardrails = client.get("/api/v1/audit?type=guardrail", headers=headers).json()
    assert any(
        e["event_type"] == "GUARDRAIL_UNAPPROVED_ACTION"
        and e["subtype"] == "Tindakan tanpa persetujuan diblokir"
        for e in guardrails
    )

    # 4. AC: Missing required field (e.g. empty diagnosis_code) -> sandbox rejects & status FAILED
    bad_action_res = client.post(
        "/api/v1/actions",
        headers=headers,
        json={
            "action_type": "claim_submit",
            "permission_level": "L2",
            "title": "Kirim klaim tanpa diagnosis",
            "reason": "Uji validasi field wajib sandbox",
            "source_screen": "SC-10 · Antrean Tindakan",
            "payload": {
                "source_claim_form_action_id": cf["id"],
                "provider": "Allianz Care Australia",
                "policy_number": "****1234",
                "diagnosis_code": "",
                "claim_amount": "125.00 AUD",
            },
        },
    )
    assert bad_action_res.status_code == 201
    bad_action = bad_action_res.json()
    assert (
        client.post(
            f"/api/v1/actions/{bad_action['id']}/approve",
            headers=headers,
            json={"confirmed": True},
        ).status_code
        == 200
    )
    bad_approved = client.get(f"/api/v1/actions/{bad_action['id']}", headers=headers).json()
    bad_exec = client.post(
        f"/api/v1/actions/{bad_action['id']}/execute",
        headers=headers,
        json={"approved_payload_sha256": bad_approved["approved_payload_sha256"]},
    )
    assert bad_exec.status_code == 200
    assert bad_exec.json()["status"] == "FAILED"
    assert "diagnosis_code" in bad_exec.json()["failure_reason"]

    # 5. AC: Approve valid claim_submit (L2) and execute -> returns claim_ref,
    # initial status Diterima, and case status becomes SUBMITTED ("Diajukan")
    assert (
        client.post(
            f"/api/v1/actions/{sbx_action['id']}/approve",
            headers=headers,
            json={"confirmed": True},
        ).status_code
        == 200
    )
    sbx_approved = client.get(f"/api/v1/actions/{sbx_action['id']}", headers=headers).json()
    sbx_hash = sbx_approved["approved_payload_sha256"]

    # Test calling /api/sandbox/insurer/claims directly
    direct_sbx = client.post(
        "/api/sandbox/insurer/claims",
        headers=headers,
        json={
            "action_id": sbx_action["id"],
            "claim_case_id": claim_case_id,
            "approved_payload_sha256": sbx_hash,
            "attachments": [
                {"document_id": a["document_id"], "sha256": a["sha256"]} for a in attachments
            ],
        },
    )
    assert direct_sbx.status_code == 200
    sbx_body = direct_sbx.json()
    assert sbx_body["sandbox"] is True
    assert sbx_body["claim_ref"].startswith("SBX-")
    assert sbx_body["status"] == "Diterima"
    assert sbx_body["claim_case_status"] == "SUBMITTED"
    assert sbx_body["claim_case_status_label"] == "Diajukan"
    claim_ref = sbx_body["claim_ref"]

    # Case detail endpoint reflects SUBMITTED status
    case_detail = client.get(f"/api/v1/claims/{claim_case_id}", headers=headers)
    assert case_detail.status_code == 200
    assert case_detail.json()["case"]["status"] == "SUBMITTED"

    # 6. AC: Simulated status progression Diajukan -> Diproses -> Disetujui (in <= 1 min)
    step_processing = client.get(
        f"/api/v1/sandbox/insurer/claims/{claim_ref}?advance=true", headers=headers
    )
    assert step_processing.status_code == 200
    assert step_processing.json()["claim_case_status"] == "PROCESSING"
    assert step_processing.json()["claim_case_status_label"] == "Diproses"

    step_approved = client.get(
        f"/api/v1/sandbox/insurer/claims/{claim_ref}?advance=true", headers=headers
    )
    assert step_approved.status_code == 200
    assert step_approved.json()["claim_case_status"] == "APPROVED"
    assert step_approved.json()["claim_case_status_label"] == "Disetujui"

    # 7. AC: Export sandbox logs in JSON and CSV with timestamp, action_id, claim_ref, no raw PII
    logs_json_res = client.get("/api/v1/sandbox/insurer/logs?format=json", headers=headers)
    assert logs_json_res.status_code == 200
    logs_json = logs_json_res.json()
    assert len(logs_json) >= 1
    matching_log = next(entry for entry in logs_json if entry["claim_ref"] == claim_ref)
    assert matching_log["action_id"] == sbx_action["id"]
    assert matching_log["timestamp"]
    assert matching_log["tool_called"] == "submit_claim_sandbox"
    assert matching_log["sandbox"] is True
    assert "8899001234" not in str(matching_log)

    logs_csv_res = client.get("/api/v1/sandbox/insurer/logs?format=csv", headers=headers)
    assert logs_csv_res.status_code == 200
    csv_text = logs_csv_res.text
    assert "timestamp,action_id,claim_case_id,claim_ref" in csv_text
    assert claim_ref in csv_text
    assert sbx_action["id"] in csv_text
    assert "8899001234" not in csv_text
