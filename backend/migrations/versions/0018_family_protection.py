"""Add family protection and policy links.

Revision: 0018
Down Revision: 0017
"""

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade():
    # 1. Update family_members table with additional fields and session_id
    with op.batch_alter_table("family_members") as batch_op:
        batch_op.alter_column("account_id", existing_type=sa.Uuid(), nullable=True)
        batch_op.add_column(sa.Column("session_id", sa.Uuid(), nullable=True))
        batch_op.add_column(
            sa.Column("is_primary", sa.Boolean(), server_default="0", nullable=False)
        )
        batch_op.add_column(sa.Column("gender", sa.String(20), nullable=True))
        batch_op.add_column(sa.Column("occupation", sa.String(100), nullable=True))
        batch_op.add_column(sa.Column("notes", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("avatar_url", sa.String(300), nullable=True))
        batch_op.add_column(
            sa.Column(
                "authorization_status",
                sa.String(30),
                server_default="AUTHORIZED",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column("consent_confirmed", sa.Boolean(), server_default="1", nullable=False)
        )
        batch_op.add_column(
            sa.Column("consent_details", sa.JSON(), server_default="{}", nullable=False)
        )
        batch_op.add_column(
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            )
        )
        batch_op.create_foreign_key(
            "fk_family_members_session",
            "demo_sessions",
            ["session_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index("ix_family_members_session_id", ["session_id"])

    # 2. Create family_policy_links table
    op.create_table(
        "family_policy_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_member_id", sa.Uuid(), nullable=False),
        sa.Column("policy_ref", sa.String(100), nullable=False),
        sa.Column("policy_name", sa.String(200), nullable=False),
        sa.Column("provider_name", sa.String(200), nullable=False),
        sa.Column(
            "policy_type", sa.String(50), server_default="EMPLOYER_GROUP", nullable=False
        ),
        sa.Column("policy_number_masked", sa.String(50), nullable=True),
        sa.Column("coverage_role", sa.String(50), server_default="DEPENDENT", nullable=False),
        sa.Column("status", sa.String(30), server_default="ACTIVE", nullable=False),
        sa.Column(
            "verification_status", sa.String(30), server_default="VERIFIED", nullable=False
        ),
        sa.Column("coverage_summary", sa.String(), nullable=True),
        sa.Column("benefit_details", sa.JSON(), server_default="{}", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["family_member_id"],
            ["family_members.id"],
            name="fk_family_policy_links_member",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_family_policy_links_family_member_id",
        "family_policy_links",
        ["family_member_id"],
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute(sa.text('ALTER TABLE "family_policy_links" ENABLE ROW LEVEL SECURITY'))
        op.execute(
            sa.text('REVOKE ALL ON TABLE "family_policy_links" FROM anon, authenticated')
        )


def downgrade():
    op.drop_table("family_policy_links")
    with op.batch_alter_table("family_members") as batch_op:
        batch_op.drop_constraint("fk_family_members_session", type_="foreignkey")
        batch_op.drop_index("ix_family_members_session_id")
        batch_op.drop_column("updated_at")
        batch_op.drop_column("consent_details")
        batch_op.drop_column("consent_confirmed")
        batch_op.drop_column("authorization_status")
        batch_op.drop_column("avatar_url")
        batch_op.drop_column("notes")
        batch_op.drop_column("occupation")
        batch_op.drop_column("gender")
        batch_op.drop_column("is_primary")
        batch_op.drop_column("session_id")
        batch_op.alter_column("account_id", existing_type=sa.Uuid(), nullable=False)
