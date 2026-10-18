"""SC-14 context, conservative ownership and exact SC-04 integration."""

import copy
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models import AccountAuditRow, AccountFieldRow
from app.schemas.actor import Actor
from app.services.coverage_matching import match_needs
from app.tests.test_account_workspace import grant, profile_payload
from app.tests.valen_fixtures import POLICY_TEXT, workspace


def by_code(client, headers):
    response = client.get("/api/v1/coverage-needs", headers=headers)
    assert response.status_code == 200, response.text
    return {n["need_code"]: n for n in response.json()}


def test_student_worker_and_profile_edit_filters_require_official_sources(app, client):
    headers, _, _, _ = workspace(app, client)
    before = by_code(client, headers)
    assert before["OSHC"]["requirement_level"] == "REQUIRED"
    assert (
        before["OSHC"]["source_reference"]["source_url"]
        and before["OSHC"]["source_reference"]["checked_at"]
    )
    assert "WORKER_HEALTH" not in before
    body = profile_payload()
    body["occupation"] = "EMPLOYEE"
    assert client.put("/api/v1/account/profile", headers=headers, json=body).status_code == 200
    after = by_code(client, headers)
    assert "OSHC" not in after and "WORKER_HEALTH" in after
    assert after["WORKER_HEALTH"]["requirement_level"] == "RECOMMENDED"


def test_id_context_dependents_and_no_product_promotion(app, client):
    headers, _, _, _ = workspace(app, client, "ID")
    values = by_code(client, headers)
    assert "BPJS" in values and "OSHC" not in values and "LIFE" not in values
    body = profile_payload()
    body.update(
        country_code="ID", residence_context="DOMESTIC", occupation="EMPLOYEE", dependents=["child"]
    )
    client.put("/api/v1/account/profile", headers=headers, json=body)
    assert "LIFE" in by_code(client, headers)
    assert all("Fictional Test Provider" not in n["label"] for n in values.values())


@pytest.mark.parametrize(
    "cover_end,visa_end", [("2027-04-15", "2027-06-30"), ("2027-03-31", "2027-06-15")]
)
def test_ownership_unknown_dates_absent_category_and_exact_shared_76_day_gap(
    app, client, cover_end, visa_end
):
    headers, account, coverage, _ = workspace(app, client)
    body = profile_payload()
    body.update(arrival_date="2026-10-01", visa_expiry_date=visa_end)
    client.put("/api/v1/account/profile", headers=headers, json=body)
    from app.models import AccountCoverageRow

    with app.state.session_factory() as db:
        db.get(AccountCoverageRow, coverage).end_date = cover_end
        field = db.scalar(
            select(AccountFieldRow).where(
                AccountFieldRow.coverage_id == coverage,
                AccountFieldRow.field_key == "coverage_end_date",
            )
        )
        field.value = cover_end
        db.commit()
    values = by_code(client, headers)
    assert values["OSHC"]["ownership_status"] == "OWNED"
    assert "Fictional Test Provider" in values["OSHC"]["explanation"]
    assert cover_end in values["OSHC"]["explanation"]
    gap = values["OSHC"]["visa_assessment"]
    sc04 = client.get("/api/v1/account/completeness?task=visa_cover", headers=headers).json()[
        "visa_gap"
    ]
    assert sc04["gap_days"] == gap["gap_days"] == 76
    assert sc04["status"] == gap["assessment_status"] == "NEEDS_VERIFICATION"
    assert values["DENTAL"]["ownership_status"] == "NOT_OWNED"
    assert "tidak ditemukan di dokumen" in values["DENTAL"]["explanation"]
    assert values["DENTAL"]["exclusion"] is None
    with app.state.session_factory() as db:
        f = db.scalar(
            select(AccountFieldRow).where(
                AccountFieldRow.coverage_id == coverage,
                AccountFieldRow.field_key == "coverage_end_date",
            )
        )
        f.status = "UNVERIFIED"
        f.confirmed_by_user = False
        f.confidence = None
        db.commit()
    values = by_code(client, headers)
    assert values["OSHC"]["ownership_status"] == "NEEDS_CHECK"
    assert values["OSHC"]["visa_assessment"]["gap_days"] is None
    with app.state.session_factory() as db:
        assert db.scalar(
            select(AccountAuditRow).where(
                AccountAuditRow.account_id == account,
                AccountAuditRow.event_type == "COMPARE_COVERAGE_NEEDS",
            )
        )


def test_unofficial_required_rule_downgrades_and_kb_mutation_changes_list(app, client, monkeypatch):
    headers, _, _, _ = workspace(app, client)
    loader = app.state.kb_loader
    original = loader.load
    country = copy.deepcopy(original("AU"))
    country.coverage_needs[0].source_url = "https://unreviewed.example.test/visa"
    country.coverage_needs[0].label = "Changed configured need"
    monkeypatch.setattr(loader, "load", lambda c: country if c == "AU" else original(c))
    values = by_code(client, headers)
    assert values["OSHC"]["label"] == "Changed configured need"
    assert values["OSHC"]["requirement_level"] == "RECOMMENDED"
    assert not values["OSHC"]["requirement_confirmed"]


def test_exclusion_requires_exact_owned_retained_source_quote(app, client):
    headers, account, coverage, doc = workspace(app, client)
    with app.state.session_factory() as db:
        for key, value in [
            ("coverage_status", "NOT_COVERED"),
            ("exclusion_quote", POLICY_TEXT.splitlines()[1]),
        ]:
            db.add(
                AccountFieldRow(
                    account_id=account,
                    coverage_id=coverage,
                    document_id=doc,
                    field_key="benefit_dental_" + key,
                    value=value,
                    status="FOUND",
                    confirmed_by_user=True,
                    source_type="USER_CONFIRMED",
                    source_page=1,
                )
            )
        db.commit()
    dental = by_code(client, headers)["DENTAL"]
    assert (
        dental["ownership_status"] == "NOT_OWNED"
        and dental["exclusion"]["original_text"] == POLICY_TEXT.splitlines()[1]
    )
    grant(client, headers, "retention", False)
    dental = by_code(client, headers)["DENTAL"]
    assert dental["exclusion"] is None and dental["ownership_status"] == "NEEDS_CHECK"


def test_needs_scopes_and_consent_are_rechecked_and_demo_placeholders_stay_unknown(
    app, client, demo
):
    headers, account, _, _ = workspace(app, client)
    grant(client, headers, "process_documents", False)
    assert client.get("/api/v1/coverage-needs", headers=headers).status_code == 403
    assert client.get("/api/v1/coverage-needs").status_code == 401
    _, demo_headers = demo()
    assert (
        client.post(
            "/api/v1/consents",
            headers=demo_headers,
            json={"purpose": "process_documents", "granted": True},
        ).status_code
        == 200
    )
    values = by_code(client, demo_headers)
    assert values["OSHC"]["ownership_status"] == "NEEDS_CHECK"
    assert values["DENTAL"]["ownership_status"] == "NEEDS_CHECK"
    with app.state.session_factory() as db:
        result = match_needs(
            db,
            Actor(actor_type="AUTHENTICATED_ACCOUNT", account_id=account),
            app.state.kb_loader,
            now=datetime(2028, 1, 1, tzinfo=UTC),
        )
        assert next(n for n in result if n.need_code == "OSHC").ownership_status == "NEEDS_CHECK"
