"""Add a separate health-profile purpose grant.

The new purpose defaults to denied and is created lazily for existing actors. This migration only
widens the database allow-list; it never infers consent from older grants or profile data.
"""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def _replace(table: str, old_name: str, allowed: str) -> None:
    with op.batch_alter_table(table) as batch:
        batch.drop_constraint(old_name, type_="check")
        batch.create_check_constraint(old_name, f"purpose IN ({allowed})")


def upgrade():
    allowed = "'process_documents','external_ai','retention','health_profile'"
    _replace("purpose_consents", "ck_consent_purpose", allowed)
    _replace("account_consents", "ck_account_consent_purpose", allowed)


def downgrade():
    op.execute("DELETE FROM purpose_consents WHERE purpose = 'health_profile'")
    op.execute("DELETE FROM account_consents WHERE purpose = 'health_profile'")
    allowed = "'process_documents','external_ai','retention'"
    _replace("purpose_consents", "ck_consent_purpose", allowed)
    _replace("account_consents", "ck_account_consent_purpose", allowed)
