"""Tests for SC-13 Policy Wallet and Policy Intelligence."""

import hashlib
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.models import (
    AccountCoverageRow,
    AccountDocumentPageRow,
    AccountDocumentRow,
    AccountRow,
    AccountSessionRow,
)


@pytest.fixture
def kb_countries() -> str:
    return "CN,ID"


def create_test_account(app, name: str = "regina"):
    now = datetime.now(UTC)
    token = f"token-{name}-{uuid4().hex[:6]}"
    with app.state.session_factory() as db:
        acc = AccountRow(
            id=uuid4(),
            email=f"{name}_{uuid4().hex[:6]}@example.com",
            display_name=name,
            avatar_url=None,
            email_verified=True,
            created_at=now,
            updated_at=now,
        )
        db.add(acc)
        db.add(
            AccountSessionRow(
                id=uuid4(),
                account_id=acc.id,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                created_at=now,
                expires_at=now + timedelta(hours=2),
            )
        )
        db.commit()
        return acc.id, {"Authorization": f"Bearer {token}"}


def test_policy_wallet_manual_add_and_detail(app, client):
    acc_id, headers = create_test_account(app, "valen")

    # 1. Manual add policy
    payload = {
        "provider": "Allianz Indonesia",
        "plan_name": "Allianz SmartHealth Care",
        "policy_number": "ALZ-998877",
        "policy_type": "health_insurance",
        "start_date": "2024-09-01",
        "end_date": "2025-08-31",
        "status": "ACTIVE",
        "coverage_limit": "RMB 1,000,000",
        "deductible": "RMB 0",
        "currency": "RMB",
        "country_code": "CN",
        "summary": "Covers student hospitalization and outpatient treatments in China.",
        "benefits": [
            {"name": "Inpatient treatment", "limit": "RMB 1,000,000"},
            {"name": "Outpatient treatment", "limit": "RMB 200,000"},
        ],
        "exclusions": [
            "Pre-existing conditions under waiting period",
            "Routine dental and cosmetic surgery",
        ],
    }
    res = client.post("/api/v1/account/policies", json=payload, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["provider"] == "Allianz Indonesia"
    assert data["plan_name"] == "Allianz SmartHealth Care"
    assert data["evidence_status"] == "SELF_REPORTED"
    assert data["status"] in {"ACTIVE", "EXPIRING_SOON", "EXPIRED"}
    assert len(data["benefits"]) == 2
    assert len(data["exclusions"]) == 2
    assert data["coverage_limit"] == "RMB 1,000,000"
    policy_id = data["id"]

    # 2. List policies
    list_res = client.get("/api/v1/account/policies", headers=headers)
    assert list_res.status_code == 200
    items = list_res.json()
    assert len(items) == 1
    assert items[0]["id"] == policy_id

    # 3. Get single policy detail
    detail_res = client.get(f"/api/v1/account/policies/{policy_id}", headers=headers)
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["id"] == policy_id
    assert "important_dates" in detail
    assert "quick_actions" in detail

    # 4. Update policy
    update_res = client.put(
        f"/api/v1/account/policies/{policy_id}",
        json={"coverage_limit": "RMB 1,500,000", "plan_name": "Allianz SmartHealth Platinum"},
        headers=headers,
    )
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["coverage_limit"] == "RMB 1,500,000"
    assert updated["plan_name"] == "Allianz SmartHealth Platinum"

    # 5. Policy intelligence analysis
    analysis_res = client.post(f"/api/v1/account/policies/{policy_id}/analyze", headers=headers)
    assert analysis_res.status_code == 200
    analysis = analysis_res.json()
    assert len(analysis["significant_exclusions"]) > 0
    assert len(analysis["waiting_periods"]) > 0

    # 6. Delete policy
    del_res = client.delete(f"/api/v1/account/policies/{policy_id}", headers=headers)
    assert del_res.status_code == 200
    assert del_res.json()["deleted"] is True

    # 7. List policies should be empty now
    empty_list = client.get("/api/v1/account/policies", headers=headers).json()
    assert len(empty_list) == 0


def test_verified_document_backed_policy_intelligence(app, client):
    acc_id, headers = create_test_account(app, "joshua")
    now = datetime.now(UTC)

    # Insert document and coverage
    with app.state.session_factory() as db:
        doc = AccountDocumentRow(
            id=uuid4(),
            account_id=acc_id,
            original_filename="AIA_Student_Plan_2024.pdf",
            size_bytes=10240,
            sha256="abc123sha256",
            mime_type="application/pdf",
            kind="policy_document",
            country_code="CN",
            status="VERIFIED",
            created_at=now,
            processed_at=now,
        )
        db.add(doc)
        db.flush()

        # Add document page with clause text
        db.add(
            AccountDocumentPageRow(
                id=uuid4(),
                document_id=doc.id,
                page_no=3,
                text="Section 4 - Exclusions. Pre-existing conditions have a waiting period of 12 months. Routine dental and cosmetic treatments are excluded.",
                ocr_used=False,
            )
        )

        cov = AccountCoverageRow(
            id=uuid4(),
            account_id=acc_id,
            document_id=doc.id,
            country_code="CN",
            kind="student_insurance",
            provider="AIA",
            plan_name="AIA International Student Plan",
            policy_number_masked="•••• 8923",
            start_date="2024-09-01",
            end_date="2025-08-31",
            coverage_limit="RMB 1,000,000",
            evidence_status="VERIFIED",
            created_at=now,
        )
        db.add(cov)
        db.commit()
        cov_id = str(cov.id)

    # Detail check
    res = client.get(f"/api/v1/account/policies/{cov_id}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["evidence_status"] == "VERIFIED"
    assert data["source_document_count"] == 1
    assert len(data["source_documents"]) == 1

    # Analysis check with clause extraction
    analysis_res = client.post(f"/api/v1/account/policies/{cov_id}/analyze", headers=headers)
    assert analysis_res.status_code == 200
    analysis = analysis_res.json()
    assert analysis["grounded_evidence_count"] >= 1
    first_exclusion = analysis["significant_exclusions"][0]
    assert first_exclusion["is_verified"] is True
    assert first_exclusion["clause"] is not None
    assert "waiting period" in first_exclusion["clause"]["clause_text"].lower()
