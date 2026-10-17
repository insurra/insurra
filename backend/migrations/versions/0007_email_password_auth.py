"""Add email-password authentication, verification, lockout, and consent fields.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-18
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("accounts", sa.Column("password_hash", sa.String(length=255), nullable=True))
    op.add_column("accounts", sa.Column("verification_token", sa.String(length=128), nullable=True))
    op.add_column(
        "accounts", sa.Column("verification_sent_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("accounts", sa.Column("reset_token", sa.String(length=128), nullable=True))
    op.add_column(
        "accounts", sa.Column("reset_token_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "accounts",
        sa.Column(
            "failed_login_attempts",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column("accounts", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "accounts",
        sa.Column(
            "consent_decided",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_accounts_verification_token", "accounts", ["verification_token"], unique=False
    )
    op.create_index("ix_accounts_reset_token", "accounts", ["reset_token"], unique=False)


def downgrade():
    op.drop_index("ix_accounts_reset_token", table_name="accounts")
    op.drop_index("ix_accounts_verification_token", table_name="accounts")
    op.drop_column("accounts", "consent_decided")
    op.drop_column("accounts", "locked_until")
    op.drop_column("accounts", "failed_login_attempts")
    op.drop_column("accounts", "reset_token_expires_at")
    op.drop_column("accounts", "reset_token")
    op.drop_column("accounts", "verification_sent_at")
    op.drop_column("accounts", "verification_token")
    op.drop_column("accounts", "password_hash")
