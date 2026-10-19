"""Add owner-scoped claim workflow, approval, sandbox, reminder and audit tables.

Additive only. Existing demo claim cases, actions and audit rows are untouched.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-19
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "wf_claim_cases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_kind", sa.String(length=10), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("reference", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("claim_type", sa.String(length=120), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("coverage_ref", sa.String(length=64), nullable=True),
        sa.Column("coverage_label", sa.String(length=200), nullable=True),
        sa.Column("insured_person", sa.String(length=200), nullable=False),
        sa.Column("claimant_name", sa.String(length=200), nullable=True),
        sa.Column("product_id", sa.String(length=100), nullable=True),
        sa.Column("procedure_id", sa.String(length=100), nullable=True),
        sa.Column("service_date", sa.String(length=10), nullable=True),
        sa.Column("provider_name", sa.String(length=200), nullable=True),
        sa.Column("amount", sa.String(length=30), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("policy_start", sa.String(length=10), nullable=True),
        sa.Column("policy_end", sa.String(length=10), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("origin", sa.String(length=30), nullable=False),
        sa.Column("is_synthetic", sa.Boolean(), nullable=False),
        sa.Column("review_confirmed", sa.Boolean(), nullable=False),
        sa.Column("conflict_notes", sa.JSON(), nullable=False),
        sa.Column("monitoring_enabled", sa.Boolean(), nullable=False),
        sa.Column("monitoring_state", sa.String(length=40), nullable=False),
        sa.Column("notify_on_change", sa.Boolean(), nullable=False),
        sa.Column("sandbox_ref", sa.String(length=40), nullable=True),
        sa.Column("sandbox_status", sa.String(length=40), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_poll_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("poll_attempts", sa.Integer(), nullable=False),
        sa.Column("poll_failures", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_kind", "owner_id", "reference", name="uq_wf_claim_ref"),
    )
    op.create_index("ix_wf_claim_cases_owner_kind", "wf_claim_cases", ["owner_kind"])
    op.create_index("ix_wf_claim_cases_owner_id", "wf_claim_cases", ["owner_id"])
    op.create_table(
        "wf_claim_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("claim_id", sa.Uuid(), sa.ForeignKey("wf_claim_cases.id"), nullable=False),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("label", sa.String(length=300), nullable=False),
        sa.Column("label_original", sa.String(length=300), nullable=True),
        sa.Column("reason", sa.String(length=None), nullable=True),
        sa.Column("source_url", sa.String(length=500), nullable=True),
        sa.Column("kb_ref", sa.String(length=100), nullable=True),
        sa.Column("accepted_formats", sa.JSON(), nullable=False),
        sa.Column("mandatory", sa.Boolean(), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("evidence_kind", sa.String(length=40), nullable=True),
        sa.Column("user_added", sa.Boolean(), nullable=False),
        sa.Column("not_applicable", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.UniqueConstraint("claim_id", "code", name="uq_wf_item_code"),
    )
    op.create_index("ix_wf_claim_items_claim_id", "wf_claim_items", ["claim_id"])
    op.create_table(
        "wf_claim_evidence",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("claim_id", sa.Uuid(), sa.ForeignKey("wf_claim_cases.id"), nullable=False),
        sa.Column("evidence_kind", sa.String(length=40), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("content", sa.LargeBinary(), nullable=True),
        sa.Column("source_type", sa.String(length=30), nullable=False),
        sa.Column("source_document_id", sa.String(length=64), nullable=True),
        sa.Column("fields", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("is_synthetic", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_wf_claim_evidence_claim_id", "wf_claim_evidence", ["claim_id"])
    op.create_table(
        "wf_claim_drafts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("claim_id", sa.Uuid(), sa.ForeignKey("wf_claim_cases.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("form", sa.JSON(), nullable=False),
        sa.Column("missing_required", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("claim_id", name="uq_wf_claim_drafts_claim_id"),
    )
    op.create_table(
        "wf_claim_status_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("claim_id", sa.Uuid(), sa.ForeignKey("wf_claim_cases.id"), nullable=False),
        sa.Column("event_type", sa.String(length=60), nullable=False),
        sa.Column("from_status", sa.String(length=40), nullable=True),
        sa.Column("to_status", sa.String(length=40), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column("dedupe_key", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("claim_id", "dedupe_key", name="uq_wf_status_dedupe"),
    )
    op.create_index("ix_wf_claim_status_events_claim_id", "wf_claim_status_events", ["claim_id"])
    op.create_table(
        "wf_actions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_kind", sa.String(length=10), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("reference", sa.String(length=30), nullable=False),
        sa.Column("claim_id", sa.Uuid(), sa.ForeignKey("wf_claim_cases.id"), nullable=True),
        sa.Column("action_type", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("purpose", sa.String(length=500), nullable=False),
        sa.Column("destination", sa.String(length=60), nullable=False),
        sa.Column("environment", sa.String(length=20), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("payload_sha256", sa.String(length=64), nullable=False),
        sa.Column("payload_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("required_permissions", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dedupe_key", sa.String(length=120), nullable=True),
        sa.Column("ai_prepared", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_kind", "owner_id", "dedupe_key", name="uq_wf_action"),
    )
    op.create_index("ix_wf_actions_owner_kind", "wf_actions", ["owner_kind"])
    op.create_index("ix_wf_actions_owner_id", "wf_actions", ["owner_id"])
    op.create_index("ix_wf_actions_claim_id", "wf_actions", ["claim_id"])
    op.create_table(
        "wf_action_approvals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("action_id", sa.Uuid(), sa.ForeignKey("wf_actions.id"), nullable=False),
        sa.Column("owner_kind", sa.String(length=10), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("decision", sa.String(length=12), nullable=False),
        sa.Column("action_type", sa.String(length=50), nullable=False),
        sa.Column("payload_sha256", sa.String(length=64), nullable=False),
        sa.Column("payload_version", sa.Integer(), nullable=False),
        sa.Column("destination", sa.String(length=60), nullable=False),
        sa.Column("permissions", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invalidation_reason", sa.String(length=60), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_wf_action_approvals_action_id", "wf_action_approvals", ["action_id"])
    op.create_table(
        "wf_action_executions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("action_id", sa.Uuid(), sa.ForeignKey("wf_actions.id"), nullable=False),
        sa.Column(
            "approval_id", sa.Uuid(), sa.ForeignKey("wf_action_approvals.id"), nullable=False
        ),
        sa.Column("idempotency_key", sa.String(length=120), nullable=False),
        sa.Column("environment", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error_code", sa.String(length=60), nullable=True),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("idempotency_key", name="uq_wf_action_executions_idempotency"),
    )
    op.create_index("ix_wf_action_executions_action_id", "wf_action_executions", ["action_id"])
    op.create_table(
        "wf_execution_receipts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("receipt_ref", sa.String(length=40), nullable=False),
        sa.Column("action_id", sa.Uuid(), sa.ForeignKey("wf_actions.id"), nullable=False),
        sa.Column(
            "execution_id", sa.Uuid(), sa.ForeignKey("wf_action_executions.id"), nullable=False
        ),
        sa.Column("owner_kind", sa.String(length=10), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("environment", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("claim_ref", sa.String(length=40), nullable=True),
        sa.Column("payload_digest", sa.String(length=64), nullable=False),
        sa.Column("audit_event_id", sa.Uuid(), nullable=True),
        sa.Column("next_action", sa.String(length=200), nullable=True),
        sa.Column("signature", sa.String(length=64), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("receipt_ref", name="uq_wf_execution_receipts_receipt_ref"),
    )
    op.create_index("ix_wf_execution_receipts_action_id", "wf_execution_receipts", ["action_id"])
    op.create_table(
        "wf_sandbox_claims",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("claim_ref", sa.String(length=40), nullable=False),
        sa.Column("idempotency_key", sa.String(length=120), nullable=False),
        sa.Column("owner_kind", sa.String(length=10), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("payload_digest", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("decision_reason", sa.String(length=300), nullable=True),
        sa.Column("missing_items", sa.JSON(), nullable=False),
        sa.Column("history", sa.JSON(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("advance_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("claim_ref", name="uq_wf_sandbox_claims_claim_ref"),
        sa.UniqueConstraint("idempotency_key", name="uq_wf_sandbox_claims_idempotency"),
    )
    op.create_index("ix_wf_sandbox_claims_owner_kind", "wf_sandbox_claims", ["owner_kind"])
    op.create_index("ix_wf_sandbox_claims_owner_id", "wf_sandbox_claims", ["owner_id"])
    op.create_table(
        "wf_reminders",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_kind", sa.String(length=10), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("detail", sa.String(length=500), nullable=True),
        sa.Column("policy_ref", sa.String(length=64), nullable=True),
        sa.Column("claim_id", sa.Uuid(), sa.ForeignKey("wf_claim_cases.id"), nullable=True),
        sa.Column("offset_days", sa.Integer(), nullable=True),
        sa.Column("due_date", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("dedupe_key", sa.String(length=160), nullable=False),
        sa.Column("evidence_status", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_kind", "owner_id", "dedupe_key", name="uq_wf_reminder"),
    )
    op.create_index("ix_wf_reminders_owner_id", "wf_reminders", ["owner_id"])
    op.create_index("ix_wf_reminders_owner_kind", "wf_reminders", ["owner_kind"])
    op.create_table(
        "wf_agent_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_kind", sa.String(length=10), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tool", sa.String(length=60), nullable=False),
        sa.Column("outcome", sa.String(length=20), nullable=False),
        sa.Column("claim_id", sa.Uuid(), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_wf_agent_events_owner_kind", "wf_agent_events", ["owner_kind"])
    op.create_index("ix_wf_agent_events_owner_id", "wf_agent_events", ["owner_id"])
    op.create_table(
        "wf_audit_logs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_kind", sa.String(length=10), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=60), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.String(length=500), nullable=True),
        sa.Column("actor_type", sa.String(length=30), nullable=False),
        sa.Column("tool", sa.String(length=60), nullable=True),
        sa.Column("result_status", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.String(length=300), nullable=True),
        sa.Column("claim_id", sa.Uuid(), nullable=True),
        sa.Column("action_id", sa.Uuid(), nullable=True),
        sa.Column("receipt_ref", sa.String(length=40), nullable=True),
        sa.Column("evidence_refs", sa.JSON(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_wf_audit_logs_event_type", "wf_audit_logs", ["event_type"])
    op.create_index("ix_wf_audit_logs_category", "wf_audit_logs", ["category"])
    op.create_index("ix_wf_audit_logs_action_id", "wf_audit_logs", ["action_id"])
    op.create_index("ix_wf_audit_logs_created_at", "wf_audit_logs", ["created_at"])
    op.create_index("ix_wf_audit_logs_owner_id", "wf_audit_logs", ["owner_id"])
    op.create_index("ix_wf_audit_logs_owner_kind", "wf_audit_logs", ["owner_kind"])
    op.create_index("ix_wf_audit_logs_claim_id", "wf_audit_logs", ["claim_id"])


def downgrade():
    op.drop_table("wf_audit_logs")
    op.drop_table("wf_agent_events")
    op.drop_table("wf_reminders")
    op.drop_table("wf_sandbox_claims")
    op.drop_table("wf_execution_receipts")
    op.drop_table("wf_action_executions")
    op.drop_table("wf_action_approvals")
    op.drop_table("wf_actions")
    op.drop_table("wf_claim_status_events")
    op.drop_table("wf_claim_drafts")
    op.drop_table("wf_claim_evidence")
    op.drop_table("wf_claim_items")
    op.drop_table("wf_claim_cases")
