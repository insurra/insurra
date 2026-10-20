"""Add protection assessment snapshots.

Revision: 0019
Down Revision: 0018
"""

import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "account_protection_assessments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("account_id", sa.Uuid(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("assessment_version", sa.String(30), server_default="1.5.0", nullable=False),
        sa.Column("status", sa.String(30), server_default="COMPLETED", nullable=False),
        sa.Column("covered_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("attention_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("unknown_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("documents_needed_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("overall_status", sa.String(50), server_default="ON_TRACK", nullable=False),
        sa.Column("overall_headline", sa.String(255), server_default="", nullable=False),
        sa.Column("input_hash", sa.String(64), nullable=True, index=True),
        sa.Column("payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("refresh_reason", sa.String(100), server_default="INITIAL_ASSESSMENT", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("account_protection_assessments")
