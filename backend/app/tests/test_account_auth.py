"""Tests for SC-01 Account Authentication and Consent."""

import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models.auth import AccountRow


def test_registration_and_validation(client, db_session):
    # Missing/invalid email
    res = client.post(
        "/api/v1/account/auth/register",
        json={
            "email": "invalid-email",
            "password": "Password123",
            "password_confirmation": "Password123",
            "accepted_terms": True,
        },
    )
    assert res.status_code == 422

    # Password too short (<8 chars)
    res = client.post(
        "/api/v1/account/auth/register",
        json={
            "email": "user1@example.com",
            "password": "Pw1",
            "password_confirmation": "Pw1",
            "accepted_terms": True,
        },
    )
    assert res.status_code == 422

    # Password without digits
    res = client.post(
        "/api/v1/account/auth/register",
        json={
            "email": "user1@example.com",
            "password": "PasswordOnly",
            "password_confirmation": "PasswordOnly",
            "accepted_terms": True,
        },
    )
    assert res.status_code == 422

    # Password confirmation mismatch
    res = client.post(
        "/api/v1/account/auth/register",
        json={
            "email": "user1@example.com",
            "password": "Password123",
            "password_confirmation": "Different123",
            "accepted_terms": True,
        },
    )
    assert res.status_code == 422

    # Successful registration
    res = client.post(
        "/api/v1/account/auth/register",
        json={
            "email": "regina@insurra.test",
            "password": "SecurePassword123",
            "password_confirmation": "SecurePassword123",
            "accepted_terms": True,
        },
    )
    assert res.status_code == 201
    assert "Registration successful" in res.json()["message"]

    # Duplicate registration rejected
    res = client.post(
        "/api/v1/account/auth/register",
        json={
            "email": "regina@insurra.test",
            "password": "SecurePassword123",
            "password_confirmation": "SecurePassword123",
            "accepted_terms": True,
        },
    )
    assert res.status_code == 409
    assert res.json()["code"] == "EMAIL_ALREADY_REGISTERED"


def test_email_verification_and_cooldown(client, db_session):
    email = "verify_test@insurra.test"
    client.post(
        "/api/v1/account/auth/register",
        json={
            "email": email,
            "password": "SecurePassword123",
            "password_confirmation": "SecurePassword123",
            "accepted_terms": True,
        },
    )
    account = db_session.scalar(select(AccountRow).where(AccountRow.email == email))
    assert account is not None
    assert not account.email_verified
    # Tokens are stored as sha256 only and never returned; plant a known one to verify with.
    assert account.verification_token is not None and len(account.verification_token) == 64
    plain = "known-verification-token"
    account.verification_token = hashlib.sha256(plain.encode()).hexdigest()
    db_session.commit()

    # Login before verification fails with 403
    login_res = client.post(
        "/api/v1/account/auth/login",
        json={"email": email, "password": "SecurePassword123"},
    )
    assert login_res.status_code == 403
    assert login_res.json()["code"] == "EMAIL_NOT_VERIFIED"

    # Resend cooldown test
    resend_res = client.post(
        "/api/v1/account/auth/resend-verification",
        json={"email": email},
    )
    assert resend_res.status_code == 429
    assert resend_res.json()["code"] == "COOLDOWN_ACTIVE"

    # Fast-forward cooldown
    account.verification_sent_at = datetime.now(UTC) - timedelta(seconds=65)
    db_session.commit()

    resend_ok = client.post(
        "/api/v1/account/auth/resend-verification",
        json={"email": email},
    )
    assert resend_ok.status_code == 200

    # Verify with invalid token
    invalid_res = client.post(
        "/api/v1/account/auth/verify-email",
        json={"token": "invalid_token_123"},
    )
    assert invalid_res.status_code == 400

    # Verify with real token
    db_session.refresh(account)
    account.verification_token = hashlib.sha256(plain.encode()).hexdigest()
    db_session.commit()
    valid_res = client.post(
        "/api/v1/account/auth/verify-email",
        json={"token": plain},
    )
    assert valid_res.status_code == 200

    # Now login succeeds
    login_ok = client.post(
        "/api/v1/account/auth/login",
        json={"email": email, "password": "SecurePassword123"},
    )
    assert login_ok.status_code == 200
    assert "access_token" in login_ok.json()
    assert login_ok.json()["account"]["email_verified"] is True


def test_login_lockout_after_five_failures(client, db_session):
    email = "lockout_test@insurra.test"
    client.post(
        "/api/v1/account/auth/register",
        json={
            "email": email,
            "password": "Password123",
            "password_confirmation": "Password123",
            "accepted_terms": True,
        },
    )
    account = db_session.scalar(select(AccountRow).where(AccountRow.email == email))
    account.email_verified = True
    db_session.commit()

    # 4 bad attempts return 401
    for _ in range(4):
        res = client.post(
            "/api/v1/account/auth/login",
            json={"email": email, "password": "WrongPassword123"},
        )
        assert res.status_code == 401
        assert res.json()["code"] == "INVALID_CREDENTIALS"

    # 5th bad attempt triggers lockout 423
    res5 = client.post(
        "/api/v1/account/auth/login",
        json={"email": email, "password": "WrongPassword123"},
    )
    assert res5.status_code == 423
    assert res5.json()["code"] == "ACCOUNT_LOCKED"

    # Subsequent attempt within 5 minutes still blocked even with correct password
    blocked = client.post(
        "/api/v1/account/auth/login",
        json={"email": email, "password": "Password123"},
    )
    assert blocked.status_code == 423
    assert blocked.json()["code"] == "ACCOUNT_LOCKED"


def test_forgot_and_reset_password(client, db_session):
    email = "reset_test@insurra.test"
    client.post(
        "/api/v1/account/auth/register",
        json={
            "email": email,
            "password": "OldPassword123",
            "password_confirmation": "OldPassword123",
            "accepted_terms": True,
        },
    )
    account = db_session.scalar(select(AccountRow).where(AccountRow.email == email))
    account.email_verified = True
    db_session.commit()

    # Request password reset
    forgot_res = client.post(
        "/api/v1/account/auth/forgot-password",
        json={"email": email},
    )
    assert forgot_res.status_code == 200

    db_session.refresh(account)
    assert account.reset_token is not None and len(account.reset_token) == 64
    reset_token = "known-reset-token"
    account.reset_token = hashlib.sha256(reset_token.encode()).hexdigest()
    db_session.commit()

    # Reset with valid token
    reset_res = client.post(
        "/api/v1/account/auth/reset-password",
        json={
            "token": reset_token,
            "password": "NewPassword456",
            "password_confirmation": "NewPassword456",
        },
    )
    assert reset_res.status_code == 200

    # Old password fails
    old_login = client.post(
        "/api/v1/account/auth/login",
        json={"email": email, "password": "OldPassword123"},
    )
    assert old_login.status_code == 401

    # New password succeeds
    new_login = client.post(
        "/api/v1/account/auth/login",
        json={"email": email, "password": "NewPassword456"},
    )
    assert new_login.status_code == 200


def test_bulk_consent_and_skip(client, db_session):
    email = "consent_user@insurra.test"
    client.post(
        "/api/v1/account/auth/register",
        json={
            "email": email,
            "password": "Password123",
            "password_confirmation": "Password123",
            "accepted_terms": True,
        },
    )
    account = db_session.scalar(select(AccountRow).where(AccountRow.email == email))
    account.email_verified = True
    db_session.commit()

    login = client.post(
        "/api/v1/account/auth/login",
        json={"email": email, "password": "Password123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Initially consent is not decided
    me_res = client.get("/api/v1/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["consent_decided"] is False

    # Submit consent decision
    decide_res = client.post(
        "/api/v1/account/consents/bulk",
        headers=headers,
        json={
            "process_documents": True,
            "external_ai": True,
            "retention": False,
            "skip": False,
        },
    )
    assert decide_res.status_code == 200
    assert decide_res.json()["mandatory_complete"] is True

    # Account shows consent_decided is True
    me_after = client.get("/api/v1/auth/me", headers=headers)
    assert me_after.json()["consent_decided"] is True


def register(client, email, password="Password123"):
    return client.post(
        "/api/v1/account/auth/register",
        json={
            "email": email,
            "password": password,
            "password_confirmation": password,
            "accepted_terms": True,
        },
    )


def _account(db_session, email):
    db_session.expire_all()
    return db_session.scalar(select(AccountRow).where(AccountRow.email == email))


def test_new_tokens_are_hashed_and_never_in_responses(client, db_session):
    email = "hashed@insurra.test"
    response = register(client, email)
    assert response.status_code == 201
    assert set(response.json()) == {"message"}
    account = _account(db_session, email)
    assert len(account.verification_token) == 64
    delta = account.verification_token_expires_at.replace(tzinfo=UTC) - datetime.now(UTC)
    assert timedelta(hours=47, minutes=59) < delta <= timedelta(hours=48)
    account.verification_sent_at = datetime.now(UTC) - timedelta(minutes=5)
    db_session.commit()
    resent = client.post("/api/v1/account/auth/resend-verification", json={"email": email})
    assert resent.status_code == 200 and set(resent.json()) == {"message"}
    forgot = client.post("/api/v1/account/auth/forgot-password", json={"email": email})
    assert forgot.status_code == 200 and set(forgot.json()) == {"message"}
    account = _account(db_session, email)
    assert len(account.reset_token) == 64
    # The stored hash must not be replayable as a token.
    replay = client.post(
        "/api/v1/account/auth/verify-email", json={"token": account.verification_token}
    )
    assert replay.status_code == 400


def test_legacy_plaintext_tokens_still_verify_and_reset(client, db_session):
    email = "legacy@insurra.test"
    register(client, email)
    account = _account(db_session, email)
    account.verification_token = "legacy-plain-verification"
    account.verification_token_expires_at = None
    account.verification_sent_at = None
    account.reset_token = "legacy-plain-reset"
    account.reset_token_expires_at = datetime.now(UTC) + timedelta(minutes=30)
    db_session.commit()
    verified = client.post(
        "/api/v1/account/auth/verify-email", json={"token": "legacy-plain-verification"}
    )
    assert verified.status_code == 200
    reset = client.post(
        "/api/v1/account/auth/reset-password",
        json={
            "token": "legacy-plain-reset",
            "password": "BrandNew789",
            "password_confirmation": "BrandNew789",
        },
    )
    assert reset.status_code == 200
    again = client.post(
        "/api/v1/account/auth/verify-email", json={"token": "legacy-plain-verification"}
    )
    assert again.status_code == 400


def test_verification_expiry(client, db_session):
    email = "expiry@insurra.test"
    register(client, email)
    plain = "expiring-token"
    account = _account(db_session, email)
    account.verification_token = hashlib.sha256(plain.encode()).hexdigest()
    account.verification_token_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()
    expired = client.post("/api/v1/account/auth/verify-email", json={"token": plain})
    assert expired.status_code == 400
    assert expired.json()["code"] == "INVALID_VERIFICATION_TOKEN"
    assert not _account(db_session, email).email_verified
    # Legacy row without expiry: aged from the send time.
    account = _account(db_session, email)
    account.verification_token = "legacy-old"
    account.verification_token_expires_at = None
    account.verification_sent_at = datetime.now(UTC) - timedelta(hours=49)
    db_session.commit()
    assert (
        client.post("/api/v1/account/auth/verify-email", json={"token": "legacy-old"}).status_code
        == 400
    )
    account = _account(db_session, email)
    account.verification_token = "legacy-fresh"
    account.verification_sent_at = datetime.now(UTC) - timedelta(hours=47)
    db_session.commit()
    ok = client.post("/api/v1/account/auth/verify-email", json={"token": "legacy-fresh"})
    assert ok.status_code == 200


def test_forgot_password_throttle_and_identical_responses(client, db_session):
    email = "throttle@insurra.test"
    register(client, email)
    first = client.post("/api/v1/account/auth/forgot-password", json={"email": email})
    stored = _account(db_session, email).reset_token
    second = client.post("/api/v1/account/auth/forgot-password", json={"email": email})
    unknown = client.post("/api/v1/account/auth/forgot-password", json={"email": "no@insurra.test"})
    assert first.status_code == second.status_code == unknown.status_code == 200
    assert first.json() == second.json() == unknown.json()
    assert _account(db_session, email).reset_token == stored  # throttled: not rotated
    account = _account(db_session, email)
    account.reset_token_expires_at = datetime.now(UTC) + timedelta(minutes=58)  # issued 2 min ago
    db_session.commit()
    client.post("/api/v1/account/auth/forgot-password", json={"email": email})
    assert _account(db_session, email).reset_token != stored


def test_login_does_not_reveal_unknown_emails_and_unknown_never_lock(client, db_session):
    email = "known@insurra.test"
    register(client, email)
    known = client.post(
        "/api/v1/account/auth/login", json={"email": email, "password": "WrongPassword1"}
    )
    unknown = client.post(
        "/api/v1/account/auth/login",
        json={"email": "ghost@insurra.test", "password": "WrongPassword1"},
    )
    assert known.status_code == unknown.status_code == 401
    assert known.json()["code"] == unknown.json()["code"] == "INVALID_CREDENTIALS"
    assert known.json()["message"] == unknown.json()["message"]
    for _ in range(8):
        again = client.post(
            "/api/v1/account/auth/login",
            json={"email": "ghost@insurra.test", "password": "WrongPassword1"},
        )
        assert again.status_code == 401
    # A real account still locks after repeated failures.
    for _ in range(5):
        locked = client.post(
            "/api/v1/account/auth/login", json={"email": email, "password": "WrongPassword1"}
        )
    assert locked.status_code == 423


def test_auth_capabilities_is_public_and_honest(client):
    response = client.get("/api/v1/auth/capabilities")
    assert response.status_code == 200
    assert response.json() == {"email_delivery": False, "google_oauth": True}


def test_auth_capabilities_reflects_email_delivery_enabled(client, app, monkeypatch):
    app.state.settings.email_delivery_enabled = True
    response = client.get("/api/v1/auth/capabilities")
    assert response.status_code == 200
    assert response.json()["email_delivery"] is True


def test_registration_and_password_reset_trigger_email_delivery(client, app, monkeypatch):
    sent_emails = []

    def fake_send_email(*args, **kwargs):
        sent_emails.append((args, kwargs))
        return True

    monkeypatch.setattr("app.services.email_delivery.send_email", fake_send_email)
    app.state.settings.email_delivery_enabled = True

    email = "email-delivery-user@example.com"
    reg = client.post(
        "/api/v1/account/auth/register",
        json={
            "email": email,
            "password": "Password123",
            "password_confirmation": "Password123",
            "accepted_terms": True,
        },
    )
    assert reg.status_code == 201
    assert len(sent_emails) == 1
    # send_email(to_email, subject, text_content, html_content, settings)
    assert sent_emails[0][0][0] == email
    assert "verify" in sent_emails[0][0][3]

    # Password reset
    forgot = client.post(
        "/api/v1/account/auth/forgot-password",
        json={"email": email},
    )
    assert forgot.status_code == 200
    assert len(sent_emails) == 2
    assert sent_emails[1][0][0] == email
    assert "reset" in sent_emails[1][0][3]


def test_supabase_google_redirect(client, app):
    app.state.settings.supabase_url = "https://example.supabase.co"
    res = client.get("/auth/google", follow_redirects=False)
    assert res.status_code == 303
    location = res.headers["location"]
    assert location.startswith("https://example.supabase.co/auth/v1/authorize")
    assert "provider=google" in location
    assert "auth%2Fcallback" in location or "auth/callback" in location


def test_supabase_token_login_and_account_creation(client, app, monkeypatch):
    app.state.settings.supabase_url = "https://example.supabase.co"

    mock_user = {
        "id": "11111111-2222-3333-4444-555555555555",
        "email": "supabase-user@example.com",
        "email_confirmed_at": "2026-10-20T00:00:00Z",
        "user_metadata": {
            "full_name": "Supabase User",
            "avatar_url": "https://example.com/avatar.png",
        },
    }

    monkeypatch.setattr(
        "app.api.auth._resolve_supabase_user",
        lambda body, settings: mock_user,
    )

    # First login creates account
    res = client.post(
        "/api/v1/account/auth/supabase",
        json={"access_token": "fake-supabase-jwt"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["account"]["email"] == "supabase-user@example.com"
    assert data["account"]["display_name"] == "Supabase User"
    assert data["account"]["avatar_url"] == "https://example.com/avatar.png"
    assert data["account"]["email_verified"] is True
    assert "access_token" in data

    token = data["access_token"]
    # Verify access token works with /auth/me
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "supabase-user@example.com"

    # Second login with same Supabase user id reuses account
    res2 = client.post(
        "/api/v1/account/auth/supabase",
        json={"access_token": "fake-supabase-jwt"},
    )
    assert res2.status_code == 200
    assert res2.json()["account"]["id"] == data["account"]["id"]


def test_supabase_otp_verification_flow(client, app, db_session, monkeypatch):
    app.state.settings.supabase_url = "https://example.supabase.co"

    dispatched = []

    def mock_send_otp(email, settings, is_signup=True):
        dispatched.append((email, is_signup))
        return True

    def mock_verify_otp(email, token, otp_type, settings):
        return token == "654321"

    monkeypatch.setattr("app.services.email_delivery.send_supabase_otp_email", mock_send_otp)
    monkeypatch.setattr("app.services.email_delivery.send_email", lambda *a, **k: True)
    monkeypatch.setattr("app.api.auth.verify_supabase_otp", mock_verify_otp)
    monkeypatch.setattr(
        "app.api.auth.supabase_signup",
        lambda email, pw, name, settings: {"id": "mock-supa-id"},
    )
    monkeypatch.setattr(
        "app.api.auth.supabase_login_password",
        lambda email, pw, settings: {
            "access_token": "mock-access-token",
            "user": {
                "id": "mock-supa-id",
                "email": email,
                "email_confirmed_at": "2026-10-20T00:00:00Z",
                "user_metadata": {"full_name": "OTP User"},
            },
        },
    )

    email = "otp-user@example.com"
    reg = client.post(
        "/api/v1/account/auth/register",
        json={
            "email": email,
            "password": "Password123",
            "password_confirmation": "Password123",
            "accepted_terms": True,
        },
    )
    assert reg.status_code == 201

    # Backdate verification_sent_at to satisfy the 60s cooldown
    account = _account(db_session, email)
    account.verification_sent_at = datetime.now(UTC) - timedelta(seconds=65)
    db_session.commit()

    # Resend triggers Supabase OTP dispatch
    resend = client.post(
        "/api/v1/account/auth/resend-verification",
        json={"email": email},
    )
    assert resend.status_code == 200
    assert len(dispatched) == 1
    assert dispatched[0][0] == email

    # Attempt verify with invalid OTP
    bad_verify = client.post(
        "/api/v1/account/auth/verify-email",
        json={"email": email, "token": "000000"},
    )
    assert bad_verify.status_code == 400

    # Verify with valid Supabase 6-digit OTP
    good_verify = client.post(
        "/api/v1/account/auth/verify-email",
        json={"email": email, "token": "654321"},
    )
    assert good_verify.status_code == 200
    assert "verified" in good_verify.json()["message"].lower()

    # Login succeeds now that account is verified
    login_res = client.post(
        "/api/v1/account/auth/login",
        json={"email": email, "password": "Password123"},
    )
    assert login_res.status_code == 200
    assert login_res.json()["account"]["email_verified"] is True
