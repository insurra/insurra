"""Add honest action creation time and payload version for review.

Existing action primitives have unknown creation time and version; leave them null.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-19
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("actions", sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("actions", sa.Column("payload_version", sa.Integer(), nullable=True))
    op.create_index(
        "ix_actions_session_status_created", "actions", ["session_id", "status", "created_at"]
    )


def downgrade():
    op.drop_index("ix_actions_session_status_created", table_name="actions")
    op.drop_column("actions", "payload_version")
    op.drop_column("actions", "created_at")
