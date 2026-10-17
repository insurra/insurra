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
from app.models import AccountRow, AccountSessionRow, OAuthIdentityRow
from app.schemas.actor import Actor, ActorType
from app.schemas.foundation import AccountSummary

public_router = APIRouter(prefix="/auth", tags=["Authentication"])
api_router = APIRouter(prefix="/auth", tags=["Authentication"])

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


def _account_summary(account: AccountRow) -> AccountSummary:
    return AccountSummary(
        id=account.id,
        email=account.email,
        display_name=account.display_name,
        avatar_url=account.avatar_url,
        email_verified=account.email_verified,
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


def _active_account(db: DB, authorization: str | None) -> tuple[AccountSessionRow, AccountRow]:
    if not authorization or not authorization.startswith("Bearer "):
        raise AppError(401, "INVALID_ACCOUNT_SESSION", "Silakan masuk untuk melanjutkan.")
    token = authorization.removeprefix("Bearer ").strip()
    if not token or len(token) > 256:
        raise AppError(401, "INVALID_ACCOUNT_SESSION", "Sesi akun tidak valid.")
    session = db.scalar(
        select(AccountSessionRow).where(
            AccountSessionRow.token_hash == hashlib.sha256(token.encode()).hexdigest()
        )
    )
    now = datetime.now(UTC)
    if (
        session is None
        or session.revoked_at is not None
        or session.expires_at.replace(tzinfo=UTC) <= now
    ):
        raise AppError(401, "INVALID_ACCOUNT_SESSION", "Sesi akun tidak valid atau kedaluwarsa.")
    account = db.get(AccountRow, session.account_id)
    if account is None:
        raise AppError(401, "INVALID_ACCOUNT_SESSION", "Sesi akun tidak valid.")
    return session, account


@api_router.get("/me", response_model=AccountSummary)
def account_me(db: DB, authorization: str | None = Header(default=None, max_length=300)):
    _, account = _active_account(db, authorization)
    return _account_summary(account)


@api_router.post("/logout", status_code=204)
def logout(db: DB, authorization: str | None = Header(default=None, max_length=300)):
    session, _ = _active_account(db, authorization)
    session.revoked_at = datetime.now(UTC)
    db.commit()
    return Response(status_code=204)
