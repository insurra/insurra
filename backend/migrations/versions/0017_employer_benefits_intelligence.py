"""Add employer benefits profile and coordination tables.

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-20
"""

from alembic import op
import sqlalchemy as sa


revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "employer_benefits",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("account_id", sa.Uuid(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("company_name", sa.String(200), nullable=False),
        sa.Column("employment_status", sa.String(50), nullable=False, server_default="Full-time employee"),
        sa.Column("employment_start_date", sa.String(20), nullable=True),
        sa.Column("employment_end_date", sa.String(20), nullable=True),
        sa.Column("plan_name", sa.String(200), nullable=False),
        sa.Column("insurer_name", sa.String(200), nullable=True),
        sa.Column("policy_number", sa.String(100), nullable=True),
        sa.Column("eligible_dependents", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("claim_procedure_cashless", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("claim_procedure_reimbursement", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("source_document_id", sa.Uuid(), sa.ForeignKey("account_documents.id", ondelete="SET NULL"), nullable=True),
        sa.Column("verification_status", sa.String(30), nullable=False, server_default="UNVERIFIED"),
        sa.Column("benefits_data", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("employer_benefits")
