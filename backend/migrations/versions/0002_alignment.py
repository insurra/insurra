"""Add purpose grants and owner-scoped identifiers without rewriting Phase 1 data."""

from uuid import NAMESPACE_URL, uuid5

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_context().as_sql:
        raise RuntimeError("0002 requires online migration to preserve legacy consent data")
    op.create_table(
        "purpose_consents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id"), nullable=False),
        sa.Column("purpose", sa.String(30), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("policy_version", sa.String(30), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("session_id", "purpose", name="uq_consent_session_purpose"),
        sa.CheckConstraint(
            "purpose IN ('process_documents','external_ai','retention')", name="ck_consent_purpose"
        ),
    )
    op.create_index("ix_purpose_consents_session_id", "purpose_consents", ["session_id"])
    # Read existing booleans without importing live application models into migration history.
    connection = op.get_bind()
    legacy = sa.table(
        "consents",
        sa.column("session_id", sa.Uuid()),
        sa.column("processing_consent", sa.Boolean()),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    table = sa.table(
        "purpose_consents",
        sa.column("id", sa.Uuid()),
        sa.column("session_id", sa.Uuid()),
        sa.column("purpose", sa.String()),
        sa.column("granted", sa.Boolean()),
        sa.column("policy_version", sa.String()),
        sa.column("granted_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    for row in connection.execute(sa.select(legacy)).mappings().all():
        for purpose in ("process_documents", "external_ai", "retention"):
            is_granted = (
                bool(row["processing_consent"]) if purpose == "process_documents" else False
            )
            connection.execute(
                table.insert().values(
                    id=uuid5(NAMESPACE_URL, f"insurra/consent/{row['session_id']}/{purpose}"),
                    session_id=row["session_id"],
                    purpose=purpose,
                    granted=is_granted,
                    policy_version="legacy-v1",
                    granted_at=row["updated_at"] if is_granted else None,
                    updated_at=row["updated_at"],
                )
            )
    op.create_table(
        "documents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id"), nullable=False),
        sa.Column("kind", sa.String(100), nullable=False),
        sa.Column("country_code", sa.String(2), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(100)),
        sa.Column("sha256", sa.String(64)),
        sa.Column("storage_path", sa.String(500)),
        sa.Column("language", sa.String(10)),
        sa.Column("has_text_layer", sa.Boolean()),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("injection_flag", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("id", "session_id", name="uq_document_owner"),
        sa.UniqueConstraint("session_id", "sha256", name="uq_document_owner_hash"),
    )
    op.create_index("ix_documents_session_id", "documents", ["session_id"])
    op.create_table(
        "extracted_fields",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id"), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("field_key", sa.String(100), nullable=False),
        sa.Column("value", sa.JSON()),
        sa.Column("previous_value", sa.JSON()),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("confidence", sa.Float()),
        sa.Column("source_page", sa.Integer()),
        sa.Column("confirmed_by_user", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id", "session_id"],
            ["documents.id", "documents.session_id"],
            name="fk_field_owned_document",
        ),
        sa.CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="ck_field_confidence",
        ),
        sa.CheckConstraint("source_page IS NULL OR source_page >= 1", name="ck_field_page"),
    )
    for column in ["session_id", "document_id"]:
        op.create_index(f"ix_extracted_fields_{column}", "extracted_fields", [column])
    op.create_table(
        "claim_cases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id"), nullable=False),
        sa.Column("coverage_id", sa.Uuid(), nullable=False),
        sa.Column("country_code", sa.String(2), nullable=False),
        sa.Column("path", sa.String(100), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("id", "session_id", name="uq_claim_owner"),
    )
    op.create_index("ix_claim_cases_session_id", "claim_cases", ["session_id"])
    op.create_table(
        "actions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("demo_sessions.id"), nullable=False),
        sa.Column("claim_case_id", sa.Uuid()),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("approved_payload_sha256", sa.String(64)),
        sa.ForeignKeyConstraint(
            ["claim_case_id", "session_id"],
            ["claim_cases.id", "claim_cases.session_id"],
            name="fk_action_owned_claim",
        ),
    )
    for column in ["session_id", "claim_case_id"]:
        op.create_index(f"ix_actions_{column}", "actions", [column])


def downgrade():
    for name in ["actions", "claim_cases", "extracted_fields", "documents", "purpose_consents"]:
        op.drop_table(name)
