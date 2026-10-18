"""SC-07 acceptance: synthetic triage/tariffs never activate production medical data."""

from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models import AccountAuditRow, AccountCoverageRow, AccountFieldRow, PathwayDecisionRow
from app.schemas.common import VerificationStatus
from app.schemas.kb import ReferenceTariff
from app.tests.valen_fixtures import reviewed_triage, workspace


def request(client, h, country="AU", **changes):
    return client.post(
        "/api/v1/pathways/compare",
        headers=h,
        json={
            "complaint": "Periksa kebutuhan layanan non-darurat",
            "service_type": "GP" if country == "AU" else "OUTPATIENT",
            "city": "Test City",
            "timeframe": "this_week",
            **changes,
        },
    )


def fields(app, account, coverage, doc, **values):
    with app.state.session_factory() as db:
        for key, value in values.items():
            row = db.scalar(
                select(AccountFieldRow).where(
                    AccountFieldRow.coverage_id == coverage, AccountFieldRow.field_key == key
                )
            )
            if row:
                row.value = value
                row.status = "FOUND"
                row.confirmed_by_user = True
            else:
                db.add(
                    AccountFieldRow(
                        account_id=account,
                        coverage_id=coverage,
                        document_id=doc,
                        field_key=key,
                        value=value,
                        status="FOUND",
                        source_type="USER_CONFIRMED",
                        source_page=1,
                        confirmed_by_user=True,
                    )
                )
        db.commit()


@pytest.mark.parametrize("code", ["AU", "ID"])
def test_country_cards_unknown_costs_no_false_denial_and_masked_state(
    client, app, monkeypatch, code
):
    country = reviewed_triage(app, monkeypatch)[code]
    h, account, coverage, doc = workspace(app, client, code)
    if code == "ID":
        with app.state.session_factory() as db:
            db.add(
                AccountCoverageRow(
                    id=uuid4(),
                    account_id=account,
                    document_id=None,
                    country_code=code,
                    kind="EMPLOYER_HEALTH",
                    provider="Fictional Employer",
                    start_date="2026-01-01",
                    end_date="2027-04-15",
                )
            )
            db.commit()
    response = request(client, h, code, complaint="PRIVATE COMPLAINT 123")
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result["paths"]) == 2
    assert result["context_country_code"] == code
    assert result["comparison_id"]
    assert all(
        3 <= len(p["steps"]) <= 5 and p["docs"] and p["requirements"] for p in result["paths"]
    )
    assert all(
        p["est_out_of_pocket"] is None and not p["best_for_priority"] for p in result["paths"]
    )
    assert "tidak ditanggung" not in str(result).lower()
    assert len(result["uncertainties"]) <= 5
    assert any(q["code"] == "provider_network" for q in result["uncertainties"])
    if code == "ID":
        assert any(q["code"] == "kapj" for q in result["uncertainties"])
    summary = client.get("/api/v1/home/summary", headers=h).json()
    assert summary["service_types"] == [s.model_dump() for s in country.pathways.service_types]
    with app.state.session_factory() as db:
        decision = db.scalar(
            select(PathwayDecisionRow).where(PathwayDecisionRow.account_id == account)
        )
        assert "PRIVATE" not in str(decision.options)
        audit = db.scalars(
            select(AccountAuditRow).where(
                AccountAuditRow.account_id == account, AccountAuditRow.event_type == "COMPARE"
            )
        ).all()
        assert len(audit) == 1 and audit[0].metadata_json == {
            "subtype": "pathways",
            "match_count": 2,
        }


def test_fail_closed_and_red_flags_produce_zero_comparisons(client, app, monkeypatch):
    h, account, _, _ = workspace(app, client)
    assert request(client, h).json()["code"] == "TRIAGE_UNAVAILABLE"
    reviewed_triage(app, monkeypatch)
    for phrase in ("sesak napas berat", "chest pain", "tidak sesak napas"):
        response = request(client, h, complaint=phrase)
        assert response.json() == {"redirect": "emergency"}
    with app.state.session_factory() as db:
        assert not db.scalars(
            select(PathwayDecisionRow).where(PathwayDecisionRow.account_id == account)
        ).all()
        audit = db.scalars(
            select(AccountAuditRow).where(
                AccountAuditRow.account_id == account, AccountAuditRow.event_type == "GUARDRAIL"
            )
        ).all()
        assert len(audit) == 3
        assert all(a.metadata_json["subtype"] == "red_flag" for a in audit)


@pytest.mark.parametrize(
    "changes",
    [
        {"complaint": " "},
        {"complaint": "a" * 301},
        {"service_type": ""},
        {"service_type": "foreign"},
        {"timeframe": "yesterday"},
    ],
)
def test_form_boundaries(client, app, monkeypatch, changes):
    reviewed_triage(app, monkeypatch)
    h, _, _, _ = workspace(app, client)
    assert request(client, h, **changes).status_code == 422


def configure_costs(country):
    # Fictional provider price configuration, isolated from shipped KB.
    for i, config in enumerate(country.pathways.pathways):
        config.tariff = ReferenceTariff(
            minimum="100" if i == 0 else "200",
            maximum="120" if i == 0 else "220",
            currency="AUD",
            source_url="https://synthetic.example.test/tariff",
            checked_at="2026-10-18",
            verification_status="VERIFIED",
        )


def verify_conditions(app, account, coverage, doc):
    fields(
        app,
        account,
        coverage,
        doc,
        provider_network_status="in_network",
        referral_status="not_required",
        benefit_outpatient_claim_mode="DIRECT_BILLING",
        benefit_outpatient_coverage_status="COVERED",
        benefit_outpatient_excess="20",
        benefit_outpatient_coverage_rate="0.8",
        benefit_outpatient_network_only=True,
        benefit_outpatient_requires_referral=False,
    )


def test_decimal_cost_priority_and_all_verified_are_evidence_based(client, app, monkeypatch):
    country = reviewed_triage(app, monkeypatch)["AU"]
    configure_costs(country)
    h, account, coverage, doc = workspace(app, client)
    verify_conditions(app, account, coverage, doc)
    profile = client.get("/api/v1/account/profile", headers=h).json()["profile"]
    # Existing account profile uses full input, not a second profile API.
    body = {k: v for k, v in profile.items() if k not in {"id", "created_at", "updated_at"}}
    body["priorities"] = ["low_cost"]
    assert client.put("/api/v1/account/profile", headers=h, json=body).status_code == 200
    response = request(client, h)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["uncertainties"] == []
    gp, urgent = result["paths"]
    assert gp["est_out_of_pocket"]["minimum"] == "36.00"
    assert gp["est_out_of_pocket"]["maximum"] == "40.00"
    assert gp["best_for_priority"] and gp["priority_reason"]
    assert not urgent["best_for_priority"]
    assert gp["direct_billing"] is True


@pytest.mark.parametrize(
    "change",
    [
        "missing_used",
        "currency",
        "unknown_network",
        "outside_network",
        "missing_referral",
        "expired_period",
        "unverified_tariff",
        "synthetic_real_account",
    ],
)
def test_cost_is_unknown_when_any_required_input_is_unavailable(client, app, monkeypatch, change):
    country = reviewed_triage(app, monkeypatch)["AU"]
    configure_costs(country)
    h, account, coverage, doc = workspace(app, client)
    verify_conditions(app, account, coverage, doc)
    if change == "missing_used":
        fields(app, account, coverage, doc, benefit_outpatient_used_amount=None)
    if change == "currency":
        fields(app, account, coverage, doc, benefit_outpatient_currency="IDR")
    if change == "unknown_network":
        fields(app, account, coverage, doc, provider_network_status="unknown")
    if change == "outside_network":
        fields(app, account, coverage, doc, provider_network_status="out_of_network")
    if change == "missing_referral":
        fields(app, account, coverage, doc, benefit_outpatient_requires_referral=True)
    if change == "expired_period":
        fields(app, account, coverage, doc, benefit_outpatient_period_end="2025-01-01")
    for path in country.pathways.pathways:
        if change == "unverified_tariff":
            path.tariff.verification_status = VerificationStatus.UNVERIFIED
        if change == "synthetic_real_account":
            path.tariff.synthetic = True
    result = request(client, h).json()
    assert all(
        p["est_out_of_pocket"] is None and not p["best_for_priority"] for p in result["paths"]
    )
    assert result["uncertainties"]


def test_kb_edit_changes_card_and_foreign_country_never_borrows_coverage(client, app, monkeypatch):
    country = reviewed_triage(app, monkeypatch)["AU"]
    h, account, coverage, doc = workspace(app, client)
    country.pathways.pathways[0].label = "Edited in KB"
    country.pathways.pathways[0].steps[0] = "New configured step"
    country.resources.verification_steps.data[1].steps = ["Configured network check"]
    result = request(client, h).json()
    assert result["paths"][0]["name"] == "Edited in KB"
    assert result["paths"][0]["steps"][0] == "New configured step"
    assert result["uncertainties"][0]["steps"] == ["Configured network check"]
    with app.state.session_factory() as db:
        db.get(AccountCoverageRow, coverage).country_code = "ID"
        db.commit()
    result = request(client, h).json()
    assert all(p["coverage_id"] is None for p in result["paths"])
    assert all(p["coverage_status"] == "NEEDS_CHECK" for p in result["paths"])


def test_processing_consent_required_but_no_external_ai_needed(client, app, monkeypatch):
    reviewed_triage(app, monkeypatch)
    h, _, _, _ = workspace(app, client)
    from app.tests.test_account_workspace import grant

    grant(client, h, "external_ai", False)
    assert request(client, h).status_code == 200
    grant(client, h, "process_documents", False)
    assert request(client, h).status_code == 403
