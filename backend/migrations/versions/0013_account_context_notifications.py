"""Demo session revocation, notifications, preferences and verification token expiry."""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def owner_columns():
    return [
        sa.Column("account_id", sa.Uuid(), sa.ForeignKey("accounts.id", ondelete="CASCADE")),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id", ondelete="CASCADE")),
        sa.CheckConstraint("(account_id IS NULL) <> (session_id IS NULL)"),
    ]


def upgrade():
    op.add_column("demo_sessions", sa.Column("revoked_at", sa.DateTime(timezone=True)))
    op.add_column(
        "accounts", sa.Column("verification_token_expires_at", sa.DateTime(timezone=True))
    )
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        *owner_columns(),
        sa.Column("type", sa.String(60), nullable=False),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("priority", sa.String(20), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.String(60)),
        sa.Column("entity_id", sa.String(64)),
        sa.Column("deep_link", sa.String(300)),
        sa.Column("event_source", sa.String(60), nullable=False),
        sa.Column("dedupe_key", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("account_id", "dedupe_key"),
        sa.UniqueConstraint("session_id", "dedupe_key"),
    )
    op.create_index("ix_notifications_account_id", "notifications", ["account_id"])
    op.create_index("ix_notifications_session_id", "notifications", ["session_id"])
    op.create_index("ix_notifications_account_read", "notifications", ["account_id", "read_at"])
    op.create_index("ix_notifications_session_read", "notifications", ["session_id", "read_at"])
    op.create_table(
        "user_preferences",
        sa.Column("id", sa.Uuid(), primary_key=True),
        *owner_columns(),
        sa.Column("notification_settings", sa.JSON(), nullable=False),
        sa.Column("display_language", sa.String(8), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("account_id"),
        sa.UniqueConstraint("session_id"),
    )
    op.create_index("ix_user_preferences_account_id", "user_preferences", ["account_id"])
    op.create_index("ix_user_preferences_session_id", "user_preferences", ["session_id"])
    if op.get_bind().dialect.name == "postgresql":
        for table in ("notifications", "user_preferences"):
            op.execute(sa.text(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'))
            op.execute(sa.text(f'REVOKE ALL ON TABLE "{table}" FROM PUBLIC'))


def downgrade():
    raise RuntimeError("Additive revision; back up data before any reviewed manual downgrade")
