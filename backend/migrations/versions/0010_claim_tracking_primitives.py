"""Persist case tracking metadata and actor-scoped timeline events.

Existing cases retain their status. Unknown sandbox data remains null.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-19
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("claim_cases", sa.Column("claim_ref", sa.String(length=100), nullable=True))
    op.add_column("claim_cases", sa.Column("sandbox_status", sa.String(length=50), nullable=True))
    op.add_column("claim_cases", sa.Column("last_checked_at", sa.DateTime(timezone=True)))
    op.add_column("claim_cases", sa.Column("monitoring_state", sa.String(length=30)))
    op.create_table(
        "claim_case_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id"), nullable=False),
        sa.Column("claim_case_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("status_snapshot", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["claim_case_id", "session_id"],
            ["claim_cases.id", "claim_cases.session_id"],
            name="fk_claim_event_owned_case",
        ),
    )
    op.create_index("ix_claim_case_events_session_id", "claim_case_events", ["session_id"])
    op.create_index("ix_claim_case_events_claim_case_id", "claim_case_events", ["claim_case_id"])


def downgrade():
    op.drop_index("ix_claim_case_events_claim_case_id", table_name="claim_case_events")
    op.drop_index("ix_claim_case_events_session_id", table_name="claim_case_events")
    op.drop_table("claim_case_events")
    op.drop_column("claim_cases", "monitoring_state")
    op.drop_column("claim_cases", "last_checked_at")
    op.drop_column("claim_cases", "sandbox_status")
    op.drop_column("claim_cases", "claim_ref")
