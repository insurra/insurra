"""Create one synthetic account in the per-run live-Gemini e2e database."""

import json
import os
from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.auth import _hash_password
from app.core.config import Settings
from app.main import create_app
from app.models import AccountRow
from app.tests.test_account_workspace import profile_payload


def main() -> None:
    database_url = os.environ.get("DATABASE_URL", "")
    if os.environ.get("INSURRA_LIVE_GEMINI") != "1":
        raise RuntimeError("Set INSURRA_LIVE_GEMINI=1 to create the synthetic test account")
    if not database_url.startswith("sqlite:///") or ".cache/e2e-live-gemini-" not in database_url:
        raise RuntimeError("Synthetic account creation requires the isolated live e2e database")

    email = f"live-gemini-{uuid4().hex[:12]}@example.test"
    password = "SyntheticPassword123"
    app = create_app(Settings())
    with app.state.session_factory() as db:
        db.add(
            AccountRow(
                email=email,
                display_name="Raka",
                email_verified=True,
                password_hash=_hash_password(password),
                consent_decided=False,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        db.commit()

    with TestClient(app) as client:
        login = client.post(
            "/api/v1/account/auth/login", json={"email": email, "password": password}
        )
        if login.status_code != 200:
            raise RuntimeError("Could not prepare the synthetic browser account")
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        profile = profile_payload()
        profile["display_name"] = "Raka"
        saved = client.put("/api/v1/account/profile", headers=headers, json=profile)
        if saved.status_code != 200:
            raise RuntimeError("Could not prepare the synthetic browser profile")

    print(json.dumps({"email": email, "password": password}))


if __name__ == "__main__":
    main()
