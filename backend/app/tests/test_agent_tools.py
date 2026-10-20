"""Tests for canonical user context loader and typed agent tool registry (B1.13)."""

import hashlib
from uuid import uuid4

import pytest

from app.agent.context import get_user_context
from app.agent.tools import (
    TOOL_REGISTRY,
    ToolPermissionClass,
    invoke_tool,
    llm_visible_tools,
)
from app.core.errors import AppError
from app.models import AccountCoverageRow, AccountSessionRow, DemoSessionRow
from app.schemas.actor import Actor, ActorType
from app.tests.test_account_workspace import account_headers, grant


def _account_actor(app, headers) -> Actor:
    token = headers["Authorization"].split()[1]
    with app.state.session_factory() as db:
        row = (
            db.query(AccountSessionRow)
            .filter_by(token_hash=hashlib.sha256(token.encode()).hexdigest())
            .one()
        )
        return Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=row.account_id)


def _demo_actor(app, headers) -> Actor:
    token = headers["X-Demo-Session"]
    with app.state.session_factory() as db:
        row = (
            db.query(DemoSessionRow)
            .filter_by(token_hash=hashlib.sha256(token.encode()).hexdigest())
            .one()
        )
        return Actor(actor_type=ActorType.DEMO_SESSION, session_id=row.id)


def test_consequential_tools_never_exposed_to_llm(app):
    visible_names = {spec.name for spec in llm_visible_tools()}
    assert "execute_approved_sandbox_action" not in visible_names
    for spec in llm_visible_tools():
        assert spec.permission_class != ToolPermissionClass.CONSEQUENTIAL_EXTERNAL

    headers = account_headers(app, "llm_block")
    actor = _account_actor(app, headers)
    with app.state.session_factory() as db, pytest.raises(AppError) as exc_info:
        invoke_tool(
            db,
            actor,
            "execute_approved_sandbox_action",
            {
                "action_id": str(uuid4()),
                "payload_sha256": "a" * 64,
                "payload_version": 1,
                "idempotency_key": "idem-12345678",
            },
            from_llm=True,
        )
    assert exc_info.value.status_code == 403
    assert exc_info.value.code == "CONSEQUENTIAL_TOOL_FORBIDDEN"


def test_tools_enforce_consent_and_owner_scoping(app, client):
    headers_a = account_headers(app, "tool_owner_a")
    headers_b = account_headers(app, "tool_owner_b")
    actor_a = _account_actor(app, headers_a)
    actor_b = _account_actor(app, headers_b)

    cov_a_id = uuid4()
    with app.state.session_factory() as db:
        db.add(
            AccountCoverageRow(
                id=cov_a_id,
                account_id=actor_a.account_id,
                document_id=None,
                country_code="CN",
                kind="INTERNATIONAL_STUDENT",
                provider="Synthetic Student Plan",
                policy_number_masked="****1234",
                start_date="2026-09-01",
                end_date="2027-04-15",
            )
        )
        db.commit()

    # Without process_documents consent, reading coverages returns 403 CONSENT_REQUIRED
    with app.state.session_factory() as db, pytest.raises(AppError) as exc_info:
        invoke_tool(db, actor_a, "get_user_coverages", {})
    assert exc_info.value.status_code == 403
    assert exc_info.value.code == "CONSENT_REQUIRED"

    grant(client, headers_a, "process_documents", True)
    grant(client, headers_b, "process_documents", True)

    # Owner A can read own coverage
    with app.state.session_factory() as db:
        res_a = invoke_tool(db, actor_a, "get_user_coverages", {"coverage_id": str(cov_a_id)})
        assert len(res_a.coverages) == 1
        assert res_a.coverages[0].id == str(cov_a_id)
        assert res_a.coverages[0].provenance.origin == "USER_DECLARED"
        assert res_a.coverages[0].verification_status == "UNVERIFIED"

    # Owner B gets 404 when requesting Owner A's coverage_id, claim_id, or action_id
    with app.state.session_factory() as db:
        for tool_name, payload in (
            ("get_user_coverages", {"coverage_id": str(cov_a_id)}),
            ("get_claim_status", {"claim_id": str(uuid4())}),
            ("get_execution_receipt", {"action_id": str(uuid4())}),
            ("get_policy_evidence", {"document_id": str(uuid4())}),
        ):
            assert tool_name in TOOL_REGISTRY
            with pytest.raises(AppError) as exc_404:
                invoke_tool(db, actor_b, tool_name, payload)
            assert exc_404.value.status_code == 404


def test_raka_demo_context_and_continuity_tool(app, client, demo):
    _, headers = demo("raka")
    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )
    actor = _demo_actor(app, headers)
    with app.state.session_factory() as db:
        ctx = get_user_context(db, actor)
        assert ctx.actor_kind == "DEMO_SESSION"
        assert ctx.synthetic is True
        assert ctx.persona_id == "raka"
        assert ctx.residence_country == "CN"
        assert ctx.kb_active is True
        assert all(c.provenance.origin == "SYNTHETIC_FIXTURE" for c in ctx.coverages)

        continuity = invoke_tool(db, actor, "evaluate_coverage_continuity", {})
        assert continuity.uncovered_days == 76
        assert continuity.status == "NEEDS_VERIFICATION"
