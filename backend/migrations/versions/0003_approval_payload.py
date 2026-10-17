"""Bind future approvals to canonical server payloads; do not approve or execute anything."""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "actions", sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
    )


def downgrade():
    op.drop_column("actions", "payload")
