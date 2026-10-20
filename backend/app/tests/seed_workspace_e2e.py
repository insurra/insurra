"""CLI-only synthetic browser fixture. Refuses any database except the E2E database."""

import json
import os
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.auth import _hash_password
from app.core.config import ROOT, Settings
from app.main import create_app
from app.models import AccountConsentRow, AccountProfileRow, AccountRow
from app.tests.workspace_fixtures import workspace


def main():
    database_url = os.environ.get("DATABASE_URL", "")
    database_path = (
        Path(database_url.removeprefix("sqlite:///"))
        if database_url.startswith("sqlite:///")
        else None
    )
    cache_dir = (ROOT / ".cache").resolve()
    isolated_e2e_database = (
        database_path is not None
        and database_path.resolve().parent == cache_dir
        and database_path.name.startswith("e2e")
        and database_path.suffix == ".db"
    )
    if os.environ.get("INSURRA_TEST_SEED") != "1" or not isolated_e2e_database:
        raise RuntimeError(
            "Synthetic fixture requires the isolated E2E database and explicit opt-in"
        )
    app = create_app(Settings(database_url=database_url, gemini_api_key=""))
    with TestClient(app) as client:
        headers, account, coverage, doc = workspace(
            app, client, os.environ.get("TEST_COUNTRY", "AU")
        )
        with app.state.session_factory() as db:
            row = db.get(AccountRow, account)
            row.password_hash = _hash_password("SyntheticPassword123")
            if os.environ.get("TEST_ACCOUNT_STAGE") == "NEW":
                row.consent_decided = False
                profile = db.get(AccountProfileRow, account)
                if profile is not None:
                    profile.completed = False
                    profile.payload = {}
                consents = db.scalars(
                    select(AccountConsentRow).where(AccountConsentRow.account_id == account)
                )
                for consent in consents:
                    consent.granted = False
                    consent.granted_at = None
                    consent.revoked_at = None
            else:
                row.consent_decided = True
            db.commit()
            print(
                json.dumps(
                    {
                        "email": row.email,
                        "password": "SyntheticPassword123",
                        "coverage_id": str(coverage),
                        "document_id": str(doc),
                        "headers": headers,
                    }
                )
            )


if __name__ == "__main__":
    main()
