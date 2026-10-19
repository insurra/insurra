"""Supabase Auth service for full authentication delegation."""

import json
import logging
from urllib.error import HTTPError
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from app.core.config import Settings
from app.core.errors import AppError

logger = logging.getLogger(__name__)


def _get_headers(settings: Settings, access_token: str | None = None) -> dict[str, str]:
    anon_key = settings.supabase_anon_key.get_secret_value() if settings.supabase_anon_key else ""
    headers = {"Content-Type": "application/json"}
    if anon_key:
        headers["apikey"] = anon_key
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    return headers


def supabase_signup(
    email: str,
    password: str,
    display_name: str | None,
    settings: Settings,
) -> dict:
    """Sign up a user via Supabase Auth."""
    if not settings.is_supabase_auth_active:
        raise AppError(503, "SUPABASE_NOT_CONFIGURED", "Supabase Auth belum dikonfigurasi.")

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/signup"
    data: dict = {
        "email": email,
        "password": password,
    }
    if display_name:
        data["data"] = {"display_name": display_name, "full_name": display_name}

    payload = json.dumps(data).encode()
    headers = _get_headers(settings)

    try:
        req = UrlRequest(url, data=payload, headers=headers, method="POST")
        with urlopen(req, timeout=15) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            err = json.loads(exc.read().decode("utf-8"))
        except Exception:
            err = {}
        msg = err.get("msg") or err.get("message") or err.get("error_description") or ""
        code = err.get("code")
        if exc.code == 422 or "already registered" in msg.lower() or code == "user_already_exists":
            raise AppError(
                409, "EMAIL_ALREADY_REGISTERED", "This email is already registered."
            ) from exc
        raise AppError(400, "SUPABASE_SIGNUP_FAILED", msg or "Pendaftaran akun gagal.") from exc
    except Exception as exc:
        logger.error("Supabase signup connection error: %s", exc)
        raise AppError(
            502, "SUPABASE_UNAVAILABLE", "Layanan autentikasi Supabase tidak dapat dihubungi."
        ) from exc


def supabase_login_password(
    email: str,
    password: str,
    settings: Settings,
) -> dict:
    """Log in a user via Supabase Auth with email & password."""
    if not settings.is_supabase_auth_active:
        raise AppError(503, "SUPABASE_NOT_CONFIGURED", "Supabase Auth belum dikonfigurasi.")

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/token?grant_type=password"
    data = {"email": email, "password": password}
    payload = json.dumps(data).encode()
    headers = _get_headers(settings)

    try:
        req = UrlRequest(url, data=payload, headers=headers, method="POST")
        with urlopen(req, timeout=15) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            err = json.loads(exc.read().decode("utf-8"))
        except Exception:
            err = {}
        err_code = err.get("error") or err.get("error_code")
        err_desc = err.get("error_description") or err.get("msg") or ""
        if "email_not_confirmed" in err_desc.lower() or err_code == "email_not_confirmed":
            raise AppError(
                403, "EMAIL_NOT_VERIFIED", "Please verify your email before logging in."
            ) from exc
        if exc.code in {400, 401} or "invalid" in err_desc.lower():
            raise AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.") from exc
        raise AppError(400, "SUPABASE_LOGIN_FAILED", err_desc or "Login gagal.") from exc
    except Exception as exc:
        logger.error("Supabase password login error: %s", exc)
        raise AppError(
            502, "SUPABASE_UNAVAILABLE", "Layanan autentikasi Supabase tidak dapat dihubungi."
        ) from exc


def supabase_verify_otp(
    email: str,
    token: str,
    otp_type: str,
    settings: Settings,
) -> dict:
    """Verify an OTP token or link token with Supabase Auth."""
    if not settings.is_supabase_auth_active:
        raise AppError(503, "SUPABASE_NOT_CONFIGURED", "Supabase Auth belum dikonfigurasi.")

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/verify"
    data = {"type": otp_type, "email": email, "token": token}
    payload = json.dumps(data).encode()
    headers = _get_headers(settings)

    try:
        req = UrlRequest(url, data=payload, headers=headers, method="POST")
        with urlopen(req, timeout=15) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            err = json.loads(exc.read().decode("utf-8"))
        except Exception:
            err = {}
        msg = (
            err.get("msg")
            or err.get("error_description")
            or "Kode verifikasi Supabase tidak valid atau kedaluwarsa."
        )
        raise AppError(400, "INVALID_VERIFICATION_TOKEN", msg) from exc
    except Exception as exc:
        logger.error("Supabase OTP verification error: %s", exc)
        raise AppError(
            502, "SUPABASE_UNAVAILABLE", "Layanan autentikasi Supabase tidak dapat dihubungi."
        ) from exc


def supabase_resend(
    email: str,
    otp_type: str,
    settings: Settings,
) -> bool:
    """Resend signup verification or OTP via Supabase."""
    if not settings.is_supabase_auth_active:
        return False

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/resend"
    data = {"type": otp_type, "email": email}
    payload = json.dumps(data).encode()
    headers = _get_headers(settings)

    try:
        req = UrlRequest(url, data=payload, headers=headers, method="POST")
        with urlopen(req, timeout=15) as resp:  # noqa: S310
            return resp.status == 200
    except Exception as exc:
        logger.warning("Supabase resend failed for %s: %s", email, exc)
        return False


def supabase_recover(
    email: str,
    settings: Settings,
) -> bool:
    """Trigger password recovery via Supabase Auth."""
    if not settings.is_supabase_auth_active:
        return False

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/recover"
    data = {
        "email": email,
        "email_redirect_to": f"{settings.frontend_url.rstrip('/')}/auth?action=reset",
    }
    payload = json.dumps(data).encode()
    headers = _get_headers(settings)

    try:
        req = UrlRequest(url, data=payload, headers=headers, method="POST")
        with urlopen(req, timeout=15) as resp:  # noqa: S310
            return resp.status == 200
    except Exception as exc:
        logger.warning("Supabase recover failed for %s: %s", email, exc)
        return False


def supabase_update_password(
    access_token: str,
    new_password: str,
    settings: Settings,
) -> bool:
    """Update user's password in Supabase Auth using their session access token."""
    if not settings.is_supabase_auth_active:
        return False

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"
    data = {"password": new_password}
    payload = json.dumps(data).encode()
    headers = _get_headers(settings, access_token=access_token)

    try:
        req = UrlRequest(url, data=payload, headers=headers, method="PUT")
        with urlopen(req, timeout=15) as resp:  # noqa: S310
            return resp.status == 200
    except Exception as exc:
        logger.error("Supabase password update error: %s", exc)
        return False
