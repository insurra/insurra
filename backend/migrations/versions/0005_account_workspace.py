"""Add private account-owned profile, consent, document and field storage."""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "account_profiles",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("account_id"),
    )
    op.create_table(
        "account_consents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("purpose", sa.String(30), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("policy_version", sa.String(30), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "purpose IN ('process_documents','external_ai','retention')",
            name="ck_account_consent_purpose",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "purpose", name="uq_account_consent_purpose"),
    )
    op.create_index("ix_account_consents_account_id", "account_consents", ["account_id"])
    op.create_table(
        "account_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("country_code", sa.String(2), nullable=False),
        sa.Column("kind", sa.String(100), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("content", sa.LargeBinary()),
        sa.Column("language", sa.String(10)),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("injection_flag", sa.Boolean(), nullable=False),
        sa.Column("error_code", sa.String(60)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("size_bytes > 0 AND size_bytes <= 10485760", name="ck_account_doc_size"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "sha256", name="uq_account_document_hash"),
    )
    op.create_index("ix_account_documents_account_id", "account_documents", ["account_id"])
    op.create_table(
        "account_document_pages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("page_no", sa.Integer(), nullable=False),
        sa.Column("text", sa.String(), nullable=False),
        sa.Column("ocr_used", sa.Boolean(), nullable=False),
        sa.CheckConstraint("page_no >= 1", name="ck_account_document_page_no"),
        sa.ForeignKeyConstraint(["document_id"], ["account_documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "page_no", name="uq_account_document_page"),
    )
    op.create_index(
        "ix_account_document_pages_document_id", "account_document_pages", ["document_id"]
    )
    op.create_table(
        "account_coverages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid()),
        sa.Column("country_code", sa.String(2), nullable=False),
        sa.Column("kind", sa.String(100), nullable=False),
        sa.Column("provider", sa.String(200)),
        sa.Column("policy_number_masked", sa.String(30)),
        sa.Column("start_date", sa.String(10)),
        sa.Column("end_date", sa.String(10)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["account_documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id"),
    )
    op.create_index("ix_account_coverages_account_id", "account_coverages", ["account_id"])
    op.create_table(
        "account_fields",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid()),
        sa.Column("coverage_id", sa.Uuid()),
        sa.Column("field_key", sa.String(100), nullable=False),
        sa.Column("value", sa.JSON()),
        sa.Column("previous_value", sa.JSON()),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("confidence", sa.Float()),
        sa.Column("source_page", sa.Integer()),
        sa.Column("source_type", sa.String(30), nullable=False),
        sa.Column("confirmed_by_user", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("source_page IS NULL OR source_page >= 1", name="ck_account_field_page"),
        sa.CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="ck_account_field_confidence",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["account_documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["coverage_id"], ["account_coverages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_account_fields_account_id", "account_fields", ["account_id"])
    op.create_index("ix_account_fields_document_id", "account_fields", ["document_id"])
    op.create_index("ix_account_fields_coverage_id", "account_fields", ["coverage_id"])
    op.create_table(
        "account_audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_account_audit_events_account_id", "account_audit_events", ["account_id"])

    if op.get_bind().dialect.name == "postgresql":
        for table in (
            "account_profiles",
            "account_consents",
            "account_documents",
            "account_document_pages",
            "account_coverages",
            "account_fields",
            "account_audit_events",
        ):
            op.execute(sa.text(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'))
            op.execute(sa.text(f'REVOKE ALL ON TABLE "{table}" FROM anon, authenticated'))


def downgrade():
    op.drop_table("account_audit_events")
    op.drop_table("account_fields")
    op.drop_table("account_coverages")
    op.drop_table("account_document_pages")
    op.drop_table("account_documents")
    op.drop_table("account_consents")
    op.drop_table("account_profiles")
