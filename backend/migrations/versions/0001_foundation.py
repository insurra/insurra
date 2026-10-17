"""Session-scoped demo foundation. Explicit operations keep history immutable."""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "demo_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("persona_id", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_demo_sessions_token_hash", "demo_sessions", ["token_hash"], unique=True)
    op.create_table(
        "profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id"), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_index("ix_profiles_session_id", "profiles", ["session_id"], unique=True)
    op.create_table(
        "consents",
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id"), primary_key=True),
        sa.Column("processing_consent", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "insurance_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id"), nullable=False),
        sa.Column(
            "profile_id", sa.Uuid(), sa.ForeignKey("profiles.id"), nullable=False, unique=True
        ),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_index(
        "ix_insurance_records_session_id", "insurance_records", ["session_id"], unique=True
    )
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id"), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("outcome", sa.String(30), nullable=False),
        sa.Column("event_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_events_session_id", "audit_events", ["session_id"])
    op.create_index("ix_audit_events_event_type", "audit_events", ["event_type"])
    op.create_table(
        "persona_templates",
        sa.Column("persona_id", sa.String(50), primary_key=True),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("profile_payload", sa.JSON(), nullable=False),
        sa.Column("record_payload", sa.JSON(), nullable=False),
    )


def downgrade():
    for name in [
        "persona_templates",
        "audit_events",
        "insurance_records",
        "consents",
        "profiles",
        "demo_sessions",
    ]:
        op.drop_table(name)
