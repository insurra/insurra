"""Add family_members table for SC-18 family management."""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "family_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("relation", sa.String(50), nullable=False),
        sa.Column("birth_date", sa.String(10), nullable=True),
        sa.Column("consent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"], name="fk_family_members_account_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_family_members_account_id", "family_members", ["account_id"])

    if op.get_bind().dialect.name == "postgresql":
        op.execute(sa.text('ALTER TABLE "family_members" ENABLE ROW LEVEL SECURITY'))
        op.execute(sa.text('REVOKE ALL ON TABLE "family_members" FROM anon, authenticated'))


def downgrade():
    op.drop_table("family_members")
