"""Scoped retrieval references, interaction state and dual-actor claim creation."""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def owner_columns():
    return [
        sa.Column("account_id", sa.Uuid(), sa.ForeignKey("accounts.id", ondelete="CASCADE")),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id", ondelete="CASCADE")),
        sa.CheckConstraint("(account_id IS NULL) <> (session_id IS NULL)"),
    ]


def upgrade():
    op.create_index(
        "uq_account_document_actor", "account_documents", ["id", "account_id"], unique=True
    )
    op.create_index(
        "uq_account_coverage_actor", "account_coverages", ["id", "account_id"], unique=True
    )
    op.create_table(
        "clause_chunks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("coverage_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("page_no", sa.Integer(), nullable=False),
        sa.Column("start_offset", sa.Integer(), nullable=False),
        sa.Column("end_offset", sa.Integer(), nullable=False),
        sa.Column("text_sha256", sa.String(64), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id", "account_id"],
            ["account_documents.id", "account_documents.account_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["coverage_id", "account_id"],
            ["account_coverages.id", "account_coverages.account_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "page_no"],
            ["account_document_pages.document_id", "account_document_pages.page_no"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("coverage_id", "document_id", "page_no", "start_offset", "end_offset"),
        sa.CheckConstraint("page_no >= 1 AND start_offset >= 0 AND end_offset > start_offset"),
    )
    op.create_table(
        "recommendation_states",
        sa.Column("id", sa.Uuid(), primary_key=True),
        *owner_columns(),
        sa.Column("rule_id", sa.String(100), nullable=False),
        sa.Column("subject", sa.String(100), nullable=False),
        sa.Column("dismissed_until", sa.DateTime(timezone=True)),
        sa.Column("handled_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("account_id", "rule_id", "subject"),
        sa.UniqueConstraint("session_id", "rule_id", "subject"),
    )
    op.create_table(
        "ask_limits",
        sa.Column("id", sa.Uuid(), primary_key=True),
        *owner_columns(),
        sa.Column("timestamps", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.UniqueConstraint("account_id"),
        sa.UniqueConstraint("session_id"),
    )
    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        *owner_columns(),
        sa.Column("coverage_id", sa.Uuid()),
        sa.Column("turns", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "pathway_decisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        *owner_columns(),
        sa.Column("country_code", sa.String(2), nullable=False),
        sa.Column("options", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for table in (
        "clause_chunks",
        "recommendation_states",
        "ask_limits",
        "chat_sessions",
        "pathway_decisions",
    ):
        op.create_index(f"ix_{table}_account_id", table, ["account_id"])
        if table != "clause_chunks":
            op.create_index(f"ix_{table}_session_id", table, ["session_id"])
    for column in ("coverage_id", "document_id"):
        op.create_index(f"ix_clause_chunks_{column}", "clause_chunks", [column])
    # SQLite needs a table copy to make session ownership nullable. Defer reference
    # checks until the unchanged action->claim links point back at the restored table.
    if op.get_bind().dialect.name == "sqlite":
        # sqlite3's legacy transaction mode auto-commits standalone DDL. Start
        # a real transaction so the deferral survives CREATE/DROP/RENAME.
        if not op.get_bind().connection.driver_connection.in_transaction:
            op.execute("BEGIN")
        op.execute("PRAGMA defer_foreign_keys=ON")
    with op.batch_alter_table("claim_cases") as batch:
        batch.alter_column("session_id", existing_type=sa.Uuid(), nullable=True)
        batch.add_column(sa.Column("account_id", sa.Uuid()))
        batch.add_column(sa.Column("comparison_id", sa.Uuid()))
        batch.add_column(sa.Column("idempotency_key", sa.String(128)))
        batch.add_column(sa.Column("payload_sha256", sa.String(64)))
        batch.add_column(sa.Column("complaint_summary", sa.String(80)))
        batch.create_foreign_key(
            "fk_claim_account", "accounts", ["account_id"], ["id"], ondelete="CASCADE"
        )
        batch.create_foreign_key(
            "fk_claim_comparison",
            "pathway_decisions",
            ["comparison_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_foreign_key(
            "fk_claim_account_coverage",
            "account_coverages",
            ["coverage_id", "account_id"],
            ["id", "account_id"],
            ondelete="CASCADE",
        )
        batch.create_check_constraint(
            "ck_claim_actor", "(account_id IS NULL) <> (session_id IS NULL)"
        )
        batch.create_unique_constraint("uq_claim_account_key", ["account_id", "idempotency_key"])
        batch.create_unique_constraint("uq_claim_session_key", ["session_id", "idempotency_key"])
        batch.create_unique_constraint("uq_claim_decision", ["comparison_id"])
        batch.create_index("ix_claim_cases_account_id", ["account_id"])
    if op.get_bind().dialect.name == "sqlite":
        if op.get_bind().exec_driver_sql("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Foreign key validation failed during claim owner migration")
        # The old table's deferred DROP counter survives its replacement on
        # SQLite. All final references were checked above; resume immediate checks.
        op.execute("PRAGMA defer_foreign_keys=OFF")
    if op.get_bind().dialect.name == "postgresql":
        for table in (
            "clause_chunks",
            "recommendation_states",
            "ask_limits",
            "chat_sessions",
            "pathway_decisions",
        ):
            op.execute(sa.text(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'))
            op.execute(sa.text(f'REVOKE ALL ON TABLE "{table}" FROM PUBLIC'))


def downgrade():
    raise RuntimeError("Valen state is additive; back up data before any reviewed manual downgrade")
