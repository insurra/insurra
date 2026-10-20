import base64
import hashlib
import json
import secrets
import ssl
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from http.client import HTTPException as HTTPClientError
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from fastapi import APIRouter, Header, Request
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select

from app.core.dependencies import DB
from app.core.errors import AppError
from app.models import AccountProfileRow, AccountRow, AccountSessionRow, OAuthIdentityRow
from app.schemas.actor import Actor, ActorType
from app.schemas.foundation import (
    AccountSummary,
    AuthCapabilities,
    AuthMessage,
    AuthSession,
    EmailRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    VerificationRequest,
)
from app.services.account_access import active_account
from app.services.demo_access import reject_ambiguous_actor

public_router = APIRouter(prefix="/auth", tags=["Authentication"])
api_router = APIRouter(prefix="/auth", tags=["Authentication"])
account_auth_router = APIRouter(prefix="/account/auth", tags=["Account Authentication"])

STATE_COOKIE = "insurra_oauth_state"
VERIFIER_COOKIE = "insurra_oauth_verifier"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


@lru_cache
def _oauth_ssl_context() -> ssl.SSLContext:
    """Build a verified TLS context without inheriting Python's SSLKEYLOGFILE hook."""
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_default_certs()
    return context


def _oauth_settings(request: Request):
    settings = request.app.state.settings
    if not settings.google_client_id or not settings.google_client_secret.get_secret_value():
        raise AppError(503, "OAUTH_NOT_CONFIGURED", "Google OAuth belum dikonfigurasi.")
    return settings


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = 310_000
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${key.hex()}"


def _verify_password(password: str, hashed: str) -> bool:
    try:
        parts = hashed.split("$")
        if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
            return False
        iterations = int(parts[1])
        salt = bytes.fromhex(parts[2])
        expected_key = bytes.fromhex(parts[3])
        key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return secrets.compare_digest(key, expected_key)
    except Exception:
        return False


VERIFICATION_TTL = timedelta(hours=48)
RESET_TTL = timedelta(hours=1)
RESET_COOLDOWN_SECONDS = 60
# Verified against when the email is unknown so response time does not reveal registration.
_DUMMY_PASSWORD_HASH = _hash_password(secrets.token_urlsafe(16))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _token_candidates(token: str) -> list[str]:
    """New rows store sha256 hex (64 chars). Legacy plaintext tokens are shorter, and a
    64-char value is never compared as plaintext so a leaked hash cannot be replayed."""
    candidates = [_hash_token(token)]
    if len(token) != 64:
        candidates.append(token)
    return candidates


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _account_summary(account: AccountRow, db: DB | None = None) -> AccountSummary:
    profile_completed = False
    if db is not None:
        profile = db.get(AccountProfileRow, account.id)
        profile_completed = profile.completed if profile else False
    return AccountSummary(
        id=account.id,
        email=account.email,
        display_name=account.display_name,
        avatar_url=account.avatar_url,
        email_verified=account.email_verified,
        consent_decided=account.consent_decided,
        profile_completed=profile_completed,
        actor=Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=account.id),
    )


def _provider_json(request: UrlRequest, body: bytes | None = None) -> dict:
    try:
        with urlopen(  # noqa: S310
            request,
            data=body,
            timeout=15,
            context=_oauth_ssl_context(),
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            error_payload = json.loads(exc.read().decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            error_payload = {}
        provider_error = error_payload.get("error") if isinstance(error_payload, dict) else None
        if provider_error == "invalid_client":
            raise AppError(
                503,
                "OAUTH_CLIENT_INVALID",
                "Konfigurasi Google OAuth tidak valid.",
            ) from exc
        if provider_error in {"invalid_grant", "redirect_uri_mismatch"}:
            raise AppError(
                400,
                "OAUTH_CODE_INVALID",
                "Sesi login Google tidak valid atau kedaluwarsa. Silakan mulai ulang login.",
            ) from exc
        raise AppError(502, "OAUTH_PROVIDER_REJECTED", "Google menolak permintaan login.") from exc
    except (
        URLError,
        HTTPClientError,
        OSError,
        TimeoutError,
        UnicodeError,
        json.JSONDecodeError,
    ) as exc:
        raise AppError(502, "OAUTH_PROVIDER_UNAVAILABLE", "Google tidak dapat dihubungi.") from exc
    if not isinstance(payload, dict):
        raise AppError(502, "OAUTH_PROVIDER_INVALID_RESPONSE", "Respons Google tidak valid.")
    return payload


@public_router.get("/google")
def google_login(request: Request):
    settings = _oauth_settings(request)
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    query = urlencode(
        {
            "client_id": settings.google_client_id,
            "redirect_uri": settings.google_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "code_challenge": challenge.decode(),
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    response = RedirectResponse(f"{GOOGLE_AUTH_URL}?{query}", status_code=302)
    secure = settings.google_redirect_uri.startswith("https://")
    for name, value in ((STATE_COOKIE, state), (VERIFIER_COOKIE, verifier)):
        response.set_cookie(
            name,
            value,
            max_age=600,
            httponly=True,
            secure=secure,
            samesite="lax",
            path="/auth/google/callback",
        )
    return response


@public_router.get("/google/callback")
def google_callback(
    request: Request,
    db: DB,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    settings = _oauth_settings(request)
    failure_url = f"{settings.frontend_url.rstrip('/')}/login?error=google"
    expected_state = request.cookies.get(STATE_COOKIE)
    verifier = request.cookies.get(VERIFIER_COOKIE)
    if error or not code or not state or not expected_state or not verifier:
        return RedirectResponse(failure_url, status_code=303)
    if not secrets.compare_digest(state, expected_state):
        return RedirectResponse(failure_url, status_code=303)

    token_body = urlencode(
        {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret.get_secret_value(),
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": settings.google_redirect_uri,
        }
    ).encode()
    token_payload = _provider_json(
        UrlRequest(
            GOOGLE_TOKEN_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        ),
        token_body,
    )
    provider_token = token_payload.get("access_token")
    if not isinstance(provider_token, str):
        return RedirectResponse(failure_url, status_code=303)
    userinfo = _provider_json(
        UrlRequest(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {provider_token}"},
        )
    )
    provider_id = userinfo.get("sub")
    email = userinfo.get("email")
    email_verified = userinfo.get("email_verified") is True
    if not isinstance(provider_id, str) or not isinstance(email, str) or not email_verified:
        return RedirectResponse(failure_url, status_code=303)

    now = datetime.now(UTC)
    identity = db.scalar(
        select(OAuthIdentityRow).where(
            OAuthIdentityRow.provider == "google",
            OAuthIdentityRow.provider_user_id == provider_id,
        )
    )
    account = db.get(AccountRow, identity.account_id) if identity else None
    if account is None:
        account = db.scalar(select(AccountRow).where(AccountRow.email == email.lower()))
    if account is None:
        account = AccountRow(
            email=email.lower(),
            display_name=userinfo.get("name") if isinstance(userinfo.get("name"), str) else None,
            avatar_url=(
                userinfo.get("picture") if isinstance(userinfo.get("picture"), str) else None
            ),
            email_verified=True,
            created_at=now,
            updated_at=now,
        )
        db.add(account)
        db.flush()
    else:
        account.display_name = (
            userinfo.get("name") if isinstance(userinfo.get("name"), str) else account.display_name
        )
        account.avatar_url = (
            userinfo.get("picture")
            if isinstance(userinfo.get("picture"), str)
            else account.avatar_url
        )
        account.email_verified = True
        account.updated_at = now
    if identity is None:
        db.add(
            OAuthIdentityRow(
                account_id=account.id,
                provider="google",
                provider_user_id=provider_id,
                created_at=now,
                updated_at=now,
            )
        )

    access_token = secrets.token_urlsafe(32)
    db.add(
        AccountSessionRow(
            account_id=account.id,
            token_hash=hashlib.sha256(access_token.encode()).hexdigest(),
            created_at=now,
            expires_at=now + timedelta(days=settings.account_session_ttl_days),
            revoked_at=None,
        )
    )
    db.commit()
    response = RedirectResponse(
        f"{settings.frontend_url.rstrip('/')}/auth/callback#access_token={access_token}",
        status_code=303,
    )
    response.delete_cookie(STATE_COOKIE, path="/auth/google/callback")
    response.delete_cookie(VERIFIER_COOKIE, path="/auth/google/callback")
    return response


@account_auth_router.post("/register", response_model=AuthMessage, status_code=201)
def register(body: RegisterRequest, db: DB):
    email_clean = str(body.email).strip().lower()
    existing = db.scalar(select(AccountRow).where(AccountRow.email == email_clean))
    if existing is not None:
        raise AppError(409, "EMAIL_ALREADY_REGISTERED", "This email is already registered.")

    now = datetime.now(UTC)
    raw_pw = body.password.get_secret_value()
    # No email transport exists yet (see /auth/capabilities); the raw token is never stored,
    # returned or logged, so a new account stays unverified until delivery is configured.
    token = secrets.token_urlsafe(32)
    account = AccountRow(
        email=email_clean,
        display_name=email_clean.split("@")[0],
        email_verified=False,
        password_hash=_hash_password(raw_pw),
        verification_token=_hash_token(token),
        verification_sent_at=now,
        verification_token_expires_at=now + VERIFICATION_TTL,
        failed_login_attempts=0,
        locked_until=None,
        consent_decided=False,
        created_at=now,
        updated_at=now,
    )
    db.add(account)
    db.commit()
    return AuthMessage(
        message="Registration successful. Please check your email to verify your account."
    )


@account_auth_router.post("/login", response_model=AuthSession)
def login(body: LoginRequest, db: DB, request: Request):
    email_clean = str(body.email).strip().lower()
    now = datetime.now(UTC)
    account = db.scalar(select(AccountRow).where(AccountRow.email == email_clean))
    if account is None:
        _verify_password(body.password.get_secret_value(), _DUMMY_PASSWORD_HASH)
        raise AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.")

    if account.locked_until is not None:
        locked_until_utc = _as_utc(account.locked_until)
        if locked_until_utc > now:
            retry_after = max(1, int((locked_until_utc - now).total_seconds()))
            raise AppError(
                423,
                "ACCOUNT_LOCKED",
                "Too many failed login attempts. Please try again in 5 minutes.",
                {"locked_until": locked_until_utc.isoformat(), "retry_after": retry_after},
            )
        account.locked_until = None
        account.failed_login_attempts = 0

    raw_pw = body.password.get_secret_value()
    if not account.password_hash or not _verify_password(raw_pw, account.password_hash):
        account.failed_login_attempts += 1
        if account.failed_login_attempts >= 5:
            account.locked_until = now + timedelta(minutes=5)
            db.commit()
            raise AppError(
                423,
                "ACCOUNT_LOCKED",
                "Too many failed login attempts. Please try again in 5 minutes.",
                {"locked_until": account.locked_until.isoformat(), "retry_after": 300},
            )
        db.commit()
        raise AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.")

    if not account.email_verified:
        raise AppError(403, "EMAIL_NOT_VERIFIED", "Please verify your email before logging in.")

    account.failed_login_attempts = 0
    account.locked_until = None

    settings = request.app.state.settings
    access_token = secrets.token_urlsafe(32)
    expires_at = now + timedelta(days=settings.account_session_ttl_days)
    db.add(
        AccountSessionRow(
            account_id=account.id,
            token_hash=hashlib.sha256(access_token.encode()).hexdigest(),
            created_at=now,
            expires_at=expires_at,
            revoked_at=None,
        )
    )
    db.commit()
    return AuthSession(
        account=_account_summary(account, db),
        access_token=access_token,
        expires_at=expires_at,
    )


def _verification_expired(account: AccountRow, now: datetime) -> bool:
    if account.verification_token_expires_at is not None:
        return _as_utc(account.verification_token_expires_at) < now
    # Legacy row without expiry: age from the send time, or accept once when unknown.
    if account.verification_sent_at is not None:
        return _as_utc(account.verification_sent_at) + VERIFICATION_TTL < now
    return False


@account_auth_router.post("/verify-email", response_model=AuthMessage)
def verify_email(body: VerificationRequest, db: DB):
    token = body.token.get_secret_value().strip()
    account = db.scalar(
        select(AccountRow).where(AccountRow.verification_token.in_(_token_candidates(token)))
    )
    now = datetime.now(UTC)
    if account is None or _verification_expired(account, now):
        if account is not None:
            # An expired token is single-use garbage; clear it so it cannot be retried.
            account.verification_token = None
            account.verification_token_expires_at = None
            db.commit()
        raise AppError(400, "INVALID_VERIFICATION_TOKEN", "Invalid or expired verification token.")

    account.email_verified = True
    account.verification_token = None
    account.verification_token_expires_at = None
    account.verification_sent_at = None
    account.updated_at = now
    db.commit()
    return AuthMessage(message="Email verified successfully. Please log in.")


@account_auth_router.post("/resend-verification", response_model=AuthMessage)
def resend_verification(body: EmailRequest, db: DB):
    email_clean = str(body.email).strip().lower()
    account = db.scalar(select(AccountRow).where(AccountRow.email == email_clean))
    if account is None or account.email_verified:
        return AuthMessage(
            message="If the email is registered and unverified, a verification link has been sent."
        )

    now = datetime.now(UTC)
    if account.verification_sent_at is not None:
        diff = (now - _as_utc(account.verification_sent_at)).total_seconds()
        if diff < 60:
            retry_after = int(60 - diff)
            raise AppError(
                429,
                "COOLDOWN_ACTIVE",
                f"Please wait {retry_after} seconds before requesting another verification email.",
                {"retry_after": retry_after},
            )

    account.verification_token = _hash_token(secrets.token_urlsafe(32))
    account.verification_sent_at = now
    account.verification_token_expires_at = now + VERIFICATION_TTL
    account.updated_at = now
    db.commit()
    return AuthMessage(message="Verification email resent successfully.")


@account_auth_router.post("/forgot-password", response_model=AuthMessage)
def forgot_password(body: EmailRequest, db: DB):
    email_clean = str(body.email).strip().lower()
    account = db.scalar(select(AccountRow).where(AccountRow.email == email_clean))
    if account is not None and account.password_hash:
        now = datetime.now(UTC)
        issued_at = (
            _as_utc(account.reset_token_expires_at) - RESET_TTL
            if account.reset_token_expires_at is not None
            else None
        )
        # Throttled requests get the same response as unknown emails (no enumeration).
        if issued_at is None or (now - issued_at).total_seconds() >= RESET_COOLDOWN_SECONDS:
            account.reset_token = _hash_token(secrets.token_urlsafe(32))
            account.reset_token_expires_at = now + RESET_TTL
            account.updated_at = now
            db.commit()
    return AuthMessage(
        message="If this email is registered, password reset instructions have been sent."
    )


@account_auth_router.post("/reset-password", response_model=AuthMessage)
def reset_password(body: ResetPasswordRequest, db: DB):
    token = body.token.get_secret_value().strip()
    account = db.scalar(
        select(AccountRow).where(AccountRow.reset_token.in_(_token_candidates(token)))
    )
    now = datetime.now(UTC)
    if (
        account is None
        or account.reset_token_expires_at is None
        or _as_utc(account.reset_token_expires_at) < now
    ):
        raise AppError(400, "INVALID_RESET_TOKEN", "Password reset link is invalid or has expired.")

    raw_pw = body.password.get_secret_value()
    account.password_hash = _hash_password(raw_pw)
    account.reset_token = None
    account.reset_token_expires_at = None
    account.failed_login_attempts = 0
    account.locked_until = None
    account.updated_at = now
    db.commit()
    return AuthMessage(message="Password reset successfully. Please log in with your new password.")


@api_router.get("/capabilities", response_model=AuthCapabilities)
def capabilities(request: Request):
    settings = request.app.state.settings
    return AuthCapabilities(
        email_delivery=settings.email_delivery_enabled,
        google_oauth=bool(
            settings.google_client_id and settings.google_client_secret.get_secret_value()
        ),
    )


@api_router.get("/me", response_model=AccountSummary)
def account_me(
    db: DB,
    authorization: str | None = Header(default=None, max_length=300),
    x_demo_session: str | None = Header(default=None, max_length=128),
):
    reject_ambiguous_actor(authorization, x_demo_session)
    _, account = active_account(db, authorization)
    return _account_summary(account, db)


@api_router.post("/logout", status_code=204)
def logout(
    db: DB,
    authorization: str | None = Header(default=None, max_length=300),
    x_demo_session: str | None = Header(default=None, max_length=128),
):
    reject_ambiguous_actor(authorization, x_demo_session)
    session, _ = active_account(db, authorization)
    session.revoked_at = datetime.now(UTC)
    db.commit()
    return Response(status_code=204)
