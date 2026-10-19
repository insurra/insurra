"""CLI-only synthetic browser fixture. Refuses any database except the E2E database."""

import json
import os

from fastapi.testclient import TestClient

from app.api.auth import _hash_password
from app.core.config import ROOT, Settings
from app.main import create_app
from app.models import AccountProfileRow, AccountRow
from app.tests.workspace_fixtures import workspace


def main():
    expected = f"sqlite:///{ROOT}/.cache/e2e.db"
    if os.environ.get("INSURRA_TEST_SEED") != "1" or os.environ.get("DATABASE_URL") != expected:
        raise RuntimeError(
            "Synthetic fixture requires the isolated E2E database and explicit opt-in"
        )
    app = create_app(Settings(database_url=expected, openai_api_key=""))
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
