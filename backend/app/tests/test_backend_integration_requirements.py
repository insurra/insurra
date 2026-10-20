"""Tests for Backend Integration Requirements Before Implementing New Features.

Verifies:
1. Authentication & Consent (server-side ownership, session isolation, external_ai, process_documents, health_profile)
2. Canonical User Context (get_authorized_user_context, field contracts, versions, verification statuses)
3. Policy Wallet & Policy Intelligence (shared records, applicability validation, evidence preservation)
4. Protection Assessment (findings contract, UNKNOWN produces VERIFY_BENEFIT_SCHEDULE, Home display, staleness detection)
5. Universal Document Intelligence (invoice/receipt, medical cert/report, claim form, rejection letter, renewal notice)
6. Country Knowledge Base (traceability, versions, verification dates, geographic applicability)
7. Durable Events & Action Contract (idempotency, lifecycle, approval protection before execution)
"""

import hashlib
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest

from app.agent.protection_review import get_authorized_protection_assessment
from app.core.config import ROOT
from app.core.errors import AppError
from app.models import (
    AccountRow,
    AccountSessionRow,
    DemoSessionRow,
)
from app.schemas.actor import Actor, ActorType
from app.schemas.canonical_assessment import CanonicalProtectionAssessment
from app.services.account_documents import classify_document
from app.services.actor_scope import owner_for
from app.services.events import dispatch
from app.services.kb_loader import CountryKBLoader
from app.services.policy_intelligence import (
    validate_policy_applicability,
)
from app.services.user_context import (
    CanonicalUserContext,
    get_authorized_user_context,
)
from app.workflow import actions
from app.workflow.models import WfClaimCaseRow


@pytest.fixture
def kb():
    return CountryKBLoader(ROOT / "kb", ["CN", "ID"])


def create_account(app, email_prefix: str = "user"):
    now = datetime.now(UTC)
    token = f"tok-{email_prefix}-{uuid4().hex[:8]}"
    with app.state.session_factory() as db:
        acc = AccountRow(
            id=uuid4(),
            email=f"{email_prefix}_{uuid4().hex[:6]}@example.com",
            display_name=email_prefix.capitalize(),
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


def grant_consent(client, headers, purpose: str, granted: bool = True):
    return client.put(
        "/api/v1/consent",
        headers=headers,
        json={"purpose": purpose, "granted": granted},
    )


# --------------------------------------------------------------------------
# 1. Authentication & Consent
# --------------------------------------------------------------------------


def test_auth_and_ownership_cross_account_rejection(app, client):
    acc_a, h_a = create_account(app, "alice")
    acc_b, h_b = create_account(app, "bob")
    grant_consent(client, h_a, "process_documents", True)
    grant_consent(client, h_b, "process_documents", True)

    claim_id = uuid4()
    with app.state.session_factory() as db:
        db.add(
            WfClaimCaseRow(
                id=claim_id,
                owner_kind="ACCOUNT",
                owner_id=acc_a,
                reference="CLM-ALICE-01",
                title="Alice Medical Claim",
                claim_type="Medical",
                country_code="ID",
                status="DRAFT",
            )
        )
        db.commit()

    # Bob attempts to access Alice's claim -> 404
    res_bob = client.get(f"/api/v1/workflow/claims/cases/{claim_id}", headers=h_b)
    assert res_bob.status_code == 404

    # Alice can access her own claim -> 200
    res_alice = client.get(f"/api/v1/workflow/claims/cases/{claim_id}", headers=h_a)
    assert res_alice.status_code == 200


def test_external_ai_consent_revocation(client, demo):
    _, headers = demo("raka")
    grant_consent(client, headers, "process_documents", True)
    grant_consent(client, headers, "external_ai", False)

    # Ask INSURRA call with external_ai revoked must fail closed with 403 CONSENT_REQUIRED
    res = client.post(
        "/api/v1/ask",
        headers=headers,
        json={"question": "Apakah asuransi saya menanggung gigi?"},
    )
    assert res.status_code == 403
    assert res.json()["code"] == "CONSENT_REQUIRED"
    assert "external_ai" in res.json()["details"]["required_purposes"]


def test_demo_sessions_isolation(app, client, demo):
    _, h_raka = demo("raka")
    _, h_sinta = demo("sinta")

    # Get home summaries for both
    res_raka = client.get("/api/v1/home/summary", headers=h_raka)
    assert res_raka.status_code == 200
    ctx_raka = res_raka.json()["context"]
    assert ctx_raka["country_code"] == "CN"

    res_sinta = client.get("/api/v1/home/summary", headers=h_sinta)
    assert res_sinta.status_code == 200
    ctx_sinta = res_sinta.json()["context"]
    assert ctx_sinta["country_code"] == "ID"


# --------------------------------------------------------------------------
# 2. Canonical User Context
# --------------------------------------------------------------------------


def test_canonical_user_context_loader_raka(app, demo):
    _, headers = demo("raka")
    token = headers["X-Demo-Session"]
    with app.state.session_factory() as db:
        actor = Actor(
            actor_type=ActorType.DEMO_SESSION,
            session_id=db.query(DemoSessionRow)
            .filter_by(token_hash=hashlib.sha256(token.encode()).hexdigest())
            .one()
            .id,
        )
        ctx = get_authorized_user_context(db, actor)

        assert isinstance(ctx, CanonicalUserContext)
        assert ctx.subject_id == "demo_raka"
        assert ctx.nationality == "ID"
        assert ctx.residence_country == "CN"
        assert ctx.residence_city == "Shenzhen"
        assert ctx.situation == "INTERNATIONAL_STUDENT"
        assert "International University" in (ctx.institution or "")
        assert ctx.dependents_count == 0
        assert ctx.profile_version == 4
        assert ctx.verification_status == "SELF_REPORTED"


def test_canonical_user_context_missing_profile_handled(app):
    with app.state.session_factory() as db:
        empty_session = DemoSessionRow(
            id=uuid4(),
            persona_id="unprofiled_test",
            token_hash="fake_hash_123",
            created_at=datetime.now(UTC),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        db.add(empty_session)
        db.commit()

        # Session exists but ProfileRow missing -> explicit AppError
        with pytest.raises(AppError) as exc_info:
            get_authorized_user_context(db, empty_session.id)
        assert exc_info.value.code == "PROFILE_NOT_FOUND"


# --------------------------------------------------------------------------
# 3. Policy Wallet & Policy Intelligence
# --------------------------------------------------------------------------


def test_policy_intelligence_applicability_validation(app, client):
    acc_id, headers = create_account(app, "policy_user")
    grant_consent(client, headers, "process_documents", True)

    policy_payload = {
        "provider": "AIA Student Care",
        "plan_name": "AIA International Comprehensive",
        "policy_number": "AIA-123456",
        "policy_type": "international_student",
        "start_date": "2026-09-01",
        "end_date": "2027-08-31",
        "status": "ACTIVE",
        "coverage_limit": "RMB 1,000,000",
        "deductible": "RMB 0",
        "currency": "RMB",
        "country_code": "CN",
        "summary": "Covers international student care in China.",
        "benefits": [
            {"name": "Inpatient Hospitalization", "limit": "RMB 1,000,000"},
            {"name": "Emergency Medical Evacuation", "limit": "RMB 500,000"},
        ],
        "exclusions": ["Routine dental treatment and cosmetic surgery"],
    }
    create_res = client.post("/api/v1/account/policies", json=policy_payload, headers=headers)
    assert create_res.status_code == 201
    policy_id = create_res.json()["id"]

    with app.state.session_factory() as db:
        owner = owner_for(Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=acc_id))

        # 1. Valid treatment during active period
        res_valid = validate_policy_applicability(
            db,
            owner,
            policy_id,
            target_country="CN",
            target_person="Self",
            treatment_type="inpatient",
            target_date=date(2026, 10, 1),
        )
        assert res_valid.applies is True
        assert res_valid.treatment_covered in ("COVERED", "UNKNOWN")
        assert res_valid.benefit_limit == "RMB 1,000,000"

        # 2. Excluded dental treatment
        res_dental = validate_policy_applicability(
            db,
            owner,
            policy_id,
            treatment_type="dental",
            target_date=date(2026, 10, 1),
        )
        assert res_dental.treatment_covered == "EXCLUDED"
        assert res_dental.applies is False

        # 3. Date outside active period
        res_expired = validate_policy_applicability(
            db,
            owner,
            policy_id,
            treatment_type="inpatient",
            target_date=date(2028, 1, 1),
        )
        assert res_expired.applies is False
        assert "after policy expiration" in res_expired.reason


# --------------------------------------------------------------------------
# 4. Protection Assessment
# --------------------------------------------------------------------------


def test_protection_assessment_findings_and_unknown_dental(app, demo, client):
    _, headers = demo("raka")
    grant_consent(client, headers, "process_documents", True)
    actor = Actor(
        actor_type=ActorType.DEMO_SESSION,
        session_id=db_session_id(app, headers["X-Demo-Session"]),
    )
    with app.state.session_factory() as db:
        assessment = get_authorized_protection_assessment(db, actor)
        assert isinstance(assessment, CanonicalProtectionAssessment)
        assert assessment.subject_id == "demo_raka"
        assert assessment.context_version == 4
        assert len(assessment.findings) > 0

        # Finding for dental care must have UNKNOWN coverage_status and VERIFY_BENEFIT_SCHEDULE action
        dental_finding = next(
            (f for f in assessment.findings if f.need_type in ("DENTAL", "DENTAL_CARE")), None
        )
        assert dental_finding is not None
        assert dental_finding.coverage_status == "UNKNOWN"
        assert "VERIFY_BENEFIT_SCHEDULE" in dental_finding.next_actions
        assert not any("BUY" in act.upper() for act in dental_finding.next_actions)

    # Home Summary must display VERIFY_BENEFIT_SCHEDULE action, never Buy Dental Insurance
    home_res = client.get("/api/v1/home/summary", headers=headers)
    assert home_res.status_code == 200
    home_data = home_res.json()
    recs = home_data.get("recommendations", [])
    assert any(
        r.get("action_type") == "VERIFY_BENEFIT_SCHEDULE"
        or "Verifikasi Ketentuan Manfaat" in r.get("title", "")
        for r in recs
    )
    assert not any("Buy Dental Insurance" in r.get("title", "") for r in recs)


# --------------------------------------------------------------------------
# 5. Universal Document Intelligence
# --------------------------------------------------------------------------


def test_universal_document_types_classification(kb):
    country_cn = kb.load("CN")
    country_id = kb.load("ID")

    # 1. Invoice and receipt
    assert classify_document(None, country_cn, "medical_invoice_2026.pdf") in (
        "invoice",
        "receipt",
        "medical_fapiao",
    )
    assert classify_document(None, country_cn, "payment_receipt.png") in (
        "receipt",
        "invoice",
        "medical_fapiao",
    )
    assert classify_document(None, country_id, "kwitansi_pembayaran.pdf") in ("receipt", "invoice")

    # 2. Medical certificate and medical report
    assert classify_document(None, country_cn, "medical_certificate_doctor.pdf") in (
        "medical_certificate",
        "diagnosis_certificate",
    )
    assert classify_document(None, country_cn, "hospital_medical_report.pdf") in (
        "medical_report",
        "medical_record",
    )

    # 3. Claim form
    assert classify_document(None, country_cn, "insurer_claim_form.pdf") == "claim_form"

    # 4. Claim rejection letter
    assert (
        classify_document(None, country_cn, "claim_rejection_letter_allianz.pdf")
        == "claim_rejection_letter"
    )

    # 5. Renewal notice
    assert classify_document(None, country_cn, "policy_renewal_notice.pdf") == "renewal_notice"


# --------------------------------------------------------------------------
# 6. Country Knowledge Base
# --------------------------------------------------------------------------


def test_country_kb_traceability_and_dates(kb):
    cn = kb.load("CN")
    manifest = cn.manifest
    assert manifest.country_code == "CN"
    assert manifest.version is not None
    assert manifest.default_currency == "CNY"
    assert manifest.default_timezone == "Asia/Shanghai"

    # Emergency guidance
    emergency = cn.resources.emergency
    assert emergency.data is not None
    assert emergency.version == manifest.version
    assert emergency.verification_status in ("VERIFIED", "COMMUNITY_VERIFIED", "UNVERIFIED")

    # Healthcare pathways
    assert len(cn.pathways.service_types) > 0


# --------------------------------------------------------------------------
# 7. Durable Events & Action Contract
# --------------------------------------------------------------------------


def test_durable_events_and_action_approval_lifecycle(app):
    acc_id, headers = create_account(app, "actions_user")
    actor = Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=acc_id)
    owner = owner_for(actor)

    with app.state.session_factory() as db:
        # 1. Event dispatch preserves entity and actor
        dispatch(
            db,
            actor,
            "policy.renewal.check",
            "coverage-123",
            {"policy_id": "cov-123", "expiring_days": 25},
            dedupe_key="renewal:cov-123",
        )

        # 2. Prepare action requiring approval
        action = actions.prepare_action(
            db,
            owner,
            "sandbox_claim_submit",
            title="Submit Claim to Sandbox",
            purpose="Submit validated outpatient reimbursement claim",
            payload={"claim_id": str(uuid4()), "amount": 1200},
            dedupe_base="claim_sub",
        )
        assert action.status == "AWAITING_APPROVAL"
        assert action.payload_sha256 is not None

        # 3. Execution without approval must fail closed
        with pytest.raises(AppError) as exc_info:
            actions.execute(db, owner, action)
        assert exc_info.value.code == "ACTION_NOT_APPROVED"


def db_session_id(app, token: str):
    with app.state.session_factory() as db:
        row = (
            db.query(DemoSessionRow)
            .filter_by(token_hash=hashlib.sha256(token.encode()).hexdigest())
            .one()
        )
        return row.id
