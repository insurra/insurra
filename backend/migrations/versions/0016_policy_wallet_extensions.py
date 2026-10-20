"""Add policy wallet extensions.

Adds plan_name, deductible, coverage_limit, currency, summary,
evidence_status, policy_status, and archived to account_coverages.
"""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("account_coverages") as batch:
        batch.add_column(sa.Column("plan_name", sa.String(200), nullable=True))
        batch.add_column(sa.Column("deductible", sa.String(100), nullable=True))
        batch.add_column(sa.Column("coverage_limit", sa.String(100), nullable=True))
        batch.add_column(sa.Column("currency", sa.String(10), nullable=True, server_default="RMB"))
        batch.add_column(sa.Column("summary", sa.String(), nullable=True))
        batch.add_column(
            sa.Column(
                "evidence_status",
                sa.String(30),
                nullable=False,
                server_default="SELF_REPORTED",
            )
        )
        batch.add_column(sa.Column("policy_status", sa.String(30), nullable=True))
        batch.add_column(sa.Column("archived", sa.Boolean(), nullable=False, server_default="0"))


def downgrade():
    with op.batch_alter_table("account_coverages") as batch:
        batch.drop_column("archived")
        batch.drop_column("policy_status")
        batch.drop_column("evidence_status")
        batch.drop_column("summary")
        batch.drop_column("currency")
        batch.drop_column("coverage_limit")
        batch.drop_column("deductible")
        batch.drop_column("plan_name")
