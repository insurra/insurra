"""Tests for SC-01 Account Authentication and Consent."""

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
    token = account.verification_token
    assert token is not None

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
    valid_res = client.post(
        "/api/v1/account/auth/verify-email",
        json={"token": account.verification_token},
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
    reset_token = account.reset_token
    assert reset_token is not None

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
