"""US-07-04 real DRAFT persistence, proof binding, owner scopes and idempotency."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.models import AccountAuditRow, AccountCoverageRow, ClaimCaseRow, PathwayDecisionRow
from app.tests.test_account_workspace import grant
from app.tests.test_care_pathways import request
from app.tests.workspace_fixtures import reviewed_triage, workspace
from app.workflow.models import WfClaimCaseRow


@pytest.fixture
def kb_countries() -> str:
    # Settings override scoped to this module: it uses the inactive legacy kb/AU folder as a
    # fixture-only configuration. The default app keeps AU disabled (see conftest).
    return "AU,CN,ID"


def prepared(app, client, monkeypatch, code="AU"):
    countries = reviewed_triage(app, monkeypatch)
    h, account, coverage, doc = workspace(app, client, code)
    result = request(client, h, code, complaint="PRIVATE SYMPTOM 987").json()
    return (
        h,
        account,
        coverage,
        doc,
        countries[code],
        {
            "path": result["paths"][0]["pathway_code"],
            "coverage_id": str(coverage),
            "comparison_id": result["comparison_id"],
        },
    )


def create(client, h, body, key="synthetic-confirmation-123"):
    return client.post(
        "/api/v1/claims", headers={**h, **({"Idempotency-Key": key} if key else {})}, json=body
    )


@pytest.mark.parametrize("code", ["AU", "ID"])
def test_create_draft_real_account_one_audit_no_raw_symptom_and_privacy_cleanup(
    client, app, monkeypatch, code
):
    h, account, coverage, _, _, body = prepared(app, client, monkeypatch, code)
    result = create(client, h, body)
    assert result.status_code == 201, result.text
    case_id = UUID(result.json()["claim_case_id"])
    with app.state.session_factory() as db:
        row = db.get(ClaimCaseRow, case_id)
        assert row.status == "DRAFT" and row.account_id == account and row.session_id is None
        assert row.coverage_id == coverage and row.country_code == code and row.path == body["path"]
        assert len(row.complaint_summary) <= 80 and "PRIVATE" not in row.complaint_summary
        wf_row = db.get(WfClaimCaseRow, case_id)
        assert wf_row is not None
        assert wf_row.origin == "PATHWAY" and wf_row.origin_ref == str(case_id)
        audit = db.scalars(
            select(AccountAuditRow).where(
                AccountAuditRow.account_id == account, AccountAuditRow.event_type == "ACTION"
            )
        ).all()
        assert len(audit) == 1 and audit[0].metadata_json == {"subtype": "claim_case_created"}
    inventory = client.get("/api/v1/account/inventory", headers=h)
    assert inventory.json()["claim_case_count"] == 1
    assert (
        client.request(
            "DELETE", "/api/v1/account/data", headers=h, json={"confirm": "HAPUS"}
        ).status_code
        == 200
    )
    with app.state.session_factory() as db:
        assert db.get(ClaimCaseRow, case_id) is None
        assert db.get(WfClaimCaseRow, case_id) is None
        assert db.get(PathwayDecisionRow, UUID(body["comparison_id"])) is None


def test_double_confirmation_and_new_key_return_same_case(client, app, monkeypatch):
    h, account, _, _, _, body = prepared(app, client, monkeypatch)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: create(client, h, body), range(2)))
    assert [r.status_code for r in responses] == [201, 201]
    assert (
        responses[0].json()
        == responses[1].json()
        == create(client, h, body, "different-synthetic-key").json()
    )
    with app.state.session_factory() as db:
        assert (
            len(db.scalars(select(ClaimCaseRow).where(ClaimCaseRow.account_id == account)).all())
            == 1
        )
        assert (
            len(
                db.scalars(
                    select(AccountAuditRow).where(
                        AccountAuditRow.account_id == account,
                        AccountAuditRow.event_type == "ACTION",
                    )
                ).all()
            )
            == 1
        )


def test_key_or_comparison_cannot_be_rebound_to_different_path(client, app, monkeypatch):
    h, _, _, _, _, body = prepared(app, client, monkeypatch)
    assert create(client, h, body).status_code == 201
    other = {**body, "path": "URGENT_CARE"}
    for key in ("synthetic-confirmation-123", "different-synthetic-key"):
        response = create(client, h, other, key)
        assert response.status_code == 409 and response.json()["code"] == "IDEMPOTENCY_CONFLICT"


def test_foreign_policy_and_comparison_are_404_before_key_errors(client, app, monkeypatch):
    h, _, _, _, _, body = prepared(app, client, monkeypatch)
    other, _, foreign, _ = workspace(app, client)
    assert create(client, other, body, None).status_code == 404
    assert create(client, other, {**body, "coverage_id": str(uuid4())}, None).status_code == 404
    assert create(client, other, {**body, "coverage_id": str(foreign)}).status_code == 404
    assert create(client, h, {**body, "comparison_id": str(uuid4())}).status_code == 404


@pytest.mark.parametrize(
    "change",
    [
        "missing_key",
        "invalid_key",
        "missing_comparison",
        "unknown_path",
        "extra_symptoms",
        "expired",
        "future",
        "country",
        "profile",
        "policy",
        "kb",
        "emergency",
        "revoked",
    ],
)
def test_stale_forged_or_unguarded_creation_makes_no_case(client, app, monkeypatch, change):
    h, account, coverage, _, country, body = prepared(app, client, monkeypatch)
    key = "synthetic-confirmation-123"
    if change == "missing_key":
        key = None
    if change == "invalid_key":
        key = "invalid key"
    if change == "missing_comparison":
        body.pop("comparison_id")
    if change == "unknown_path":
        body["path"] = "unknown"
    if change == "extra_symptoms":
        body["complaint"] = "PRIVATE"
    if change in {"expired", "future"}:
        with app.state.session_factory() as db:
            decision = db.get(PathwayDecisionRow, UUID(body["comparison_id"]))
            decision.created_at = datetime.now(UTC) + timedelta(
                minutes=-16 if change == "expired" else 1
            )
            db.commit()
    if change in {"country", "profile"}:
        state = client.get("/api/v1/account/profile", headers=h).json()["profile"]
        payload = {k: v for k, v in state.items() if k not in {"id", "created_at", "updated_at"}}
        if change == "country":
            payload.update(country_code="ID", timezone="Asia/Jakarta", residence_context="DOMESTIC")
        else:
            payload["priorities"] = ["changed"]
        assert client.put("/api/v1/account/profile", headers=h, json=payload).status_code == 200
    if change == "policy":
        with app.state.session_factory() as db:
            db.get(AccountCoverageRow, coverage).end_date = "2026-01-01"
            db.commit()
    if change == "kb":
        country.pathways.pathways[0].steps[0] = "Updated procedure"
    if change == "emergency":
        country.pathways.pathways[0].emergency = True
    if change == "revoked":
        grant(client, h, "process_documents", False)
    response = create(client, h, body, key)
    assert response.status_code in {403, 409, 422}, response.text
    with app.state.session_factory() as db:
        assert not db.scalars(select(ClaimCaseRow).where(ClaimCaseRow.account_id == account)).all()
