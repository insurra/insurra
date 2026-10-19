"""Additive orchestration schema: outbox columns, protection insights, chunk language, workflow state, reminders and claim origin."""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def owner_columns():
    return [
        sa.Column("account_id", sa.Uuid(), sa.ForeignKey("accounts.id", ondelete="CASCADE")),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id", ondelete="CASCADE")),
        sa.CheckConstraint("(account_id IS NULL) <> (session_id IS NULL)"),
    ]


def upgrade():
    # 1. protection_insights table
    op.create_table(
        "protection_insights",
        sa.Column("id", sa.Uuid(), primary_key=True),
        *owner_columns(),
        sa.Column("rule_id", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(60), nullable=False),
        sa.Column("severity", sa.String(30), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="OPEN"),
        sa.Column("coverage_id", sa.String(64)),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("facts", sa.JSON(), nullable=False),
        sa.Column("evidence_refs", sa.JSON(), nullable=False),
        sa.Column("next_actions", sa.JSON(), nullable=False),
        sa.Column("input_fingerprint", sa.String(64), nullable=False),
        sa.Column("kb_version", sa.String(20), nullable=False, server_default="0.2.0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("account_id", "rule_id", "coverage_id", "input_fingerprint"),
        sa.UniqueConstraint("session_id", "rule_id", "coverage_id", "input_fingerprint"),
    )
    op.create_index("ix_protection_insights_account_id", "protection_insights", ["account_id"])
    op.create_index("ix_protection_insights_session_id", "protection_insights", ["session_id"])
    op.create_index(
        "ix_protection_insights_account_status",
        "protection_insights",
        ["account_id", "status"],
    )
    op.create_index(
        "ix_protection_insights_session_status",
        "protection_insights",
        ["session_id", "status"],
    )

    # 2. clause_chunks.language
    op.add_column(
        "clause_chunks", sa.Column("language", sa.String(16), server_default="unknown")
    )

    # 3. chat_sessions.workflow_state
    op.add_column("chat_sessions", sa.Column("workflow_state", sa.JSON()))

    # 4. wf_claim_cases additive columns
    op.add_column("wf_claim_cases", sa.Column("origin_ref", sa.String(120)))
    op.add_column("wf_claim_cases", sa.Column("idempotency_key", sa.String(120)))
    op.create_index(
        "ix_wf_claim_cases_idempotency_key", "wf_claim_cases", ["idempotency_key"]
    )

    # 5. wf_reminders additive columns
    op.add_column("wf_reminders", sa.Column("fire_at", sa.DateTime(timezone=True)))
    op.add_column("wf_reminders", sa.Column("timezone", sa.String(64)))
    op.add_column("wf_reminders", sa.Column("cancelled_at", sa.DateTime(timezone=True)))

    # 6. wf_agent_events outbox columns
    op.add_column("wf_agent_events", sa.Column("event_type", sa.String(60)))
    op.add_column("wf_agent_events", sa.Column("entity_type", sa.String(60)))
    op.add_column("wf_agent_events", sa.Column("entity_id", sa.String(64)))
    op.add_column("wf_agent_events", sa.Column("dedupe_key", sa.String(200)))
    op.add_column(
        "wf_agent_events",
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
    )
    op.add_column(
        "wf_agent_events",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "wf_agent_events", sa.Column("next_attempt_at", sa.DateTime(timezone=True))
    )
    op.add_column("wf_agent_events", sa.Column("processed_at", sa.DateTime(timezone=True)))
    op.add_column("wf_agent_events", sa.Column("error_code", sa.String(60)))
    op.add_column(
        "wf_agent_events",
        sa.Column("schema_version", sa.String(10), nullable=False, server_default="1.5"),
    )
    op.create_index("ix_wf_agent_events_event_type", "wf_agent_events", ["event_type"])
    op.create_index("ix_wf_agent_events_dedupe_key", "wf_agent_events", ["dedupe_key"])
    op.create_index(
        "ix_wf_agent_events_status_next",
        "wf_agent_events",
        ["status", "next_attempt_at"],
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute(sa.text('ALTER TABLE "protection_insights" ENABLE ROW LEVEL SECURITY'))
        op.execute(sa.text('REVOKE ALL ON TABLE "protection_insights" FROM PUBLIC'))


def downgrade():
    op.drop_index("ix_wf_agent_events_status_next", table_name="wf_agent_events")
    op.drop_index("ix_wf_agent_events_dedupe_key", table_name="wf_agent_events")
    op.drop_index("ix_wf_agent_events_event_type", table_name="wf_agent_events")
    for col in (
        "schema_version",
        "error_code",
        "processed_at",
        "next_attempt_at",
        "attempts",
        "status",
        "dedupe_key",
        "entity_id",
        "entity_type",
        "event_type",
    ):
        op.drop_column("wf_agent_events", col)

    for col in ("cancelled_at", "timezone", "fire_at"):
        op.drop_column("wf_reminders", col)

    op.drop_index("ix_wf_claim_cases_idempotency_key", table_name="wf_claim_cases")
    op.drop_column("wf_claim_cases", "idempotency_key")
    op.drop_column("wf_claim_cases", "origin_ref")

    op.drop_column("chat_sessions", "workflow_state")
    op.drop_column("clause_chunks", "language")

    op.drop_index("ix_protection_insights_session_status", table_name="protection_insights")
    op.drop_index("ix_protection_insights_account_status", table_name="protection_insights")
    op.drop_index("ix_protection_insights_session_id", table_name="protection_insights")
    op.drop_index("ix_protection_insights_account_id", table_name="protection_insights")
    op.drop_table("protection_insights")
