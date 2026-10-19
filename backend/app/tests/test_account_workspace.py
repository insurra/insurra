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
        lambda content, mime, country_code: [
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
    response = client.get("/api/v1/account/completeness?task=coverage_continuity", headers=mine)
    assert response.status_code == 200, response.text
    assert response.json()["coverage_continuity"]["gap_days"] == 4
    assert response.json()["coverage_continuity"]["status"] == "DATE_DIFFERENCE_DETECTED"
    assert response.json()["coverage_continuity"]["requirement_status"] == "NEEDS_VERIFICATION"
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


def test_continuity_without_period_or_policy_end_date_is_undetermined(app, client):
    mine = account_headers(app, "continuity_without_dates")
    payload = profile_payload()
    payload["visa_expiry_date"] = None
    assert client.put("/api/v1/account/profile", headers=mine, json=payload).status_code == 200

    result = client.get(
        "/api/v1/account/completeness?task=coverage_continuity", headers=mine
    ).json()["coverage_continuity"]

    assert result["status"] == "UNABLE_TO_DETERMINE"
    assert result["gap_days"] is None
    assert result["requirement_status"] == "NEEDS_VERIFICATION"


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
    assert my_family[0]["active_coverage_count"] is None

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
