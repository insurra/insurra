"""Fictional policy evidence; never an actual insurer's terms or medical KB."""

import hashlib
from datetime import UTC, datetime
from uuid import uuid4

from app.models import (
    AccountCoverageRow,
    AccountDocumentPageRow,
    AccountDocumentRow,
    AccountFieldRow,
)
from app.tests.test_account_workspace import account_headers, grant, profile_payload

POLICY_TEXT = (
    "FICTIONAL TEST POLICY. Not real insurance.\n"
    "General dental treatment is excluded under this fictional policy.\n"
    "GP consultations require verification of the provider network before booking.\n"
    "The outpatient benefit limit is AUD 500 and used amount is AUD 120 "
    "for the period 2026-01-01 to 2027-12-31."
)


def workspace(app, client, country="AU", suffix=None, retention=True):
    policy_text = POLICY_TEXT if country == "AU" else POLICY_TEXT.replace("AUD", "IDR")
    headers = account_headers(app, suffix or uuid4().hex[:8])
    body = profile_payload()
    body.update(
        display_name="Raka" if country == "AU" else "Sinta",
        country_code=country,
        city="Melbourne" if country == "AU" else "Jakarta",
        timezone="Australia/Melbourne" if country == "AU" else "Asia/Jakarta",
        residence_context="ABROAD" if country == "AU" else "DOMESTIC",
        occupation="STUDENT" if country == "AU" else "EMPLOYEE",
    )
    assert client.put("/api/v1/account/profile", headers=headers, json=body).status_code == 200
    for purpose in ("process_documents", "external_ai"):
        grant(client, headers, purpose)
    if retention:
        grant(client, headers, "retention")
    account_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]
    from uuid import UUID

    account_id = UUID(account_id)
    with app.state.session_factory() as db:
        doc = AccountDocumentRow(
            id=uuid4(),
            account_id=account_id,
            country_code=country,
            kind="oshc_certificate" if country == "AU" else "bpjs_card",
            original_filename="fictional-policy.pdf",
            mime_type="application/pdf",
            size_bytes=100,
            sha256=hashlib.sha256(policy_text.encode()).hexdigest(),
            content=b"%PDF-fictional" if retention else None,
            status="COMPLETED",
            injection_flag=False,
        )
        db.add(doc)
        db.flush()
        coverage = AccountCoverageRow(
            id=uuid4(),
            account_id=account_id,
            document_id=doc.id,
            country_code=country,
            kind="OSHC" if country == "AU" else "BPJS",
            provider="Fictional Test Provider",
            start_date="2026-01-01",
            end_date="2027-04-15",
        )
        db.add(coverage)
        db.flush()
        db.add(
            AccountDocumentPageRow(document_id=doc.id, page_no=1, text=policy_text, ocr_used=False)
        )
        values = {
            "coverage_start_date": "2026-01-01",
            "coverage_end_date": "2027-04-15",
            "benefit_outpatient_limit_amount": "500",
            "benefit_outpatient_used_amount": "120",
            "benefit_outpatient_currency": "AUD" if country == "AU" else "IDR",
            "benefit_outpatient_period_start": "2026-01-01",
            "benefit_outpatient_period_end": "2027-12-31",
        }
        for key, value in values.items():
            db.add(
                AccountFieldRow(
                    account_id=account_id,
                    document_id=doc.id,
                    coverage_id=coverage.id,
                    field_key=key,
                    value=value,
                    status="FOUND",
                    source_type="USER_CONFIRMED",
                    confirmed_by_user=True,
                    source_page=1,
                    confidence=0.9,
                    updated_at=datetime.now(UTC),
                )
            )
        db.commit()
        return headers, account_id, coverage.id, doc.id


def reviewed_triage(app, monkeypatch):
    """In-memory dependency fixture, never promoted to the shipped medical KB."""
    import copy
    from datetime import date

    from app.schemas.common import VerificationStatus
    from app.schemas.kb import RedFlagConfig

    loader = app.state.kb_loader
    original = loader.load
    countries = {code: copy.deepcopy(original(code)) for code in ("AU", "ID")}
    for country in countries.values():
        country.manifest.official_source_hosts.append("synthetic.example.test")
        resource = country.resources.red_flags
        resource.source_url = "https://synthetic.example.test/triage-contract"
        resource.checked_at = date(2026, 10, 18)
        resource.verification_status = VerificationStatus.VERIFIED
        resource.data = [
            RedFlagConfig(
                id="test_breathing",
                category="MEDICAL",
                phrases_id=["sesak napas", "sulit bernapas"],
                phrases_en=["shortness of breath", "difficulty breathing"],
                destination_code="emergency",
            ),
            RedFlagConfig(
                id="test_chest",
                category="MEDICAL",
                phrases_id=["nyeri dada"],
                phrases_en=["chest pain"],
                destination_code="emergency",
            ),
        ]
    monkeypatch.setattr(
        loader, "load", lambda code: countries[code] if code in countries else original(code)
    )
    return countries
