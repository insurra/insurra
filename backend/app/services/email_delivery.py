import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import Settings

logger = logging.getLogger(__name__)


def send_email(
    to_email: str,
    subject: str,
    text_content: str,
    html_content: str,
    settings: Settings,
) -> bool:
    """Send an email using SMTP or print to console if smtp_host is 'console'."""
    if not settings.is_email_delivery_active:
        return False

    if settings.smtp_host.strip().lower() in {"console", "stdout", "log"}:
        logger.info(
            "\n" + "=" * 60 + "\n"
            f"[EMAIL DELIVERY - CONSOLE MODE]\n"
            f"To: {to_email}\n"
            f"From: {settings.smtp_from_name} <{settings.smtp_from_email}>\n"
            f"Subject: {subject}\n"
            f"Body:\n{text_content}\n" + "=" * 60
        )
        return True

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    msg["To"] = to_email
    msg.attach(MIMEText(text_content, "plain", "utf-8"))
    if html_content:
        msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        if settings.smtp_use_ssl:
            server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10)
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
            if settings.smtp_use_tls:
                server.starttls()

        user = settings.smtp_user.strip()
        pw = settings.smtp_password.get_secret_value() if settings.smtp_password else ""
        if user and pw:
            server.login(user, pw)

        server.send_message(msg)
        server.quit()
        logger.info("Email '%s' sent successfully to %s", subject, to_email)
        return True
    except Exception as exc:
        logger.error("Failed to send email '%s' to %s: %s", subject, to_email, exc)
        return False


def send_verification_email(to_email: str, raw_token: str, settings: Settings) -> bool:
    """Send an account verification email containing the verification link."""
    base_url = settings.frontend_url.rstrip("/")
    verification_link = f"{base_url}/auth?action=verify&token={raw_token}"

    subject = "Verifikasi Akun Insurra Anda / Verify your Insurra account"
    text_content = (
        f"Halo,\n\n"
        f"Terima kasih telah mendaftar di Insurra.\n"
        f"Silakan klik tautan berikut untuk memverifikasi akun Anda:\n\n"
        f"{verification_link}\n\n"
        f"Tautan ini berlaku selama 48 jam.\n\n"
        f"Salam,\nTim Insurra"
    )
    html_content = (
        f"<div style='font-family: sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; "
        f"border: 1px solid #e2e8f0; rounded: 12px; background: #ffffff;'>"
        f"<h2 style='color: #0f172a; margin-top: 0;'>Verifikasi Akun Insurra</h2>"
        f"<p style='color: #475569; font-size: 14px;'>Terima kasih telah mendaftar di Insurra. "
        f"Klik tombol di bawah ini untuk mengaktifkan akun Anda:</p>"
        f"<div style='margin: 28px 0; text-align: center;'>"
        f"<a href='{verification_link}' style='background: #047857; color: #ffffff; padding: 12px 24px; "
        f"border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; "
        f"display: inline-block;'>Verifikasi Akun Saya</a>"
        f"</div>"
        f"<p style='color: #94a3b8; font-size: 12px;'>Jika tombol di atas tidak berfungsi, salin dan buka tautan berikut di browser:<br>"
        f"<a href='{verification_link}' style='color: #047857; word-break: break-all;'>{verification_link}</a></p>"
        f"<hr style='border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;'>"
        f"<p style='color: #94a3b8; font-size: 11px;'>Tautan verifikasi ini berlaku selama 48 jam. Jika Anda tidak merasa mendaftar di Insurra, abaikan email ini.</p>"
        f"</div>"
    )

    return send_email(to_email, subject, text_content, html_content, settings)


def send_password_reset_email(to_email: str, raw_token: str, settings: Settings) -> bool:
    """Send a password reset email containing the reset link."""
    base_url = settings.frontend_url.rstrip("/")
    reset_link = f"{base_url}/auth?action=reset&token={raw_token}"

    subject = "Reset Kata Sandi Insurra / Reset your Insurra password"
    text_content = (
        f"Halo,\n\n"
        f"Kami menerima permintaan untuk mereset kata sandi akun Insurra Anda.\n"
        f"Silakan klik tautan berikut untuk membuat kata sandi baru:\n\n"
        f"{reset_link}\n\n"
        f"Tautan ini berlaku selama 1 jam.\n\n"
        f"Jika Anda tidak meminta reset kata sandi, abaikan email ini.\n\n"
        f"Salam,\nTim Insurra"
    )
    html_content = (
        f"<div style='font-family: sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; "
        f"border: 1px solid #e2e8f0; rounded: 12px; background: #ffffff;'>"
        f"<h2 style='color: #0f172a; margin-top: 0;'>Atur Ulang Kata Sandi</h2>"
        f"<p style='color: #475569; font-size: 14px;'>Kami menerima permintaan untuk mereset kata sandi akun Insurra Anda. "
        f"Klik tombol di bawah ini untuk memasukkan kata sandi baru:</p>"
        f"<div style='margin: 28px 0; text-align: center;'>"
        f"<a href='{reset_link}' style='background: #0f172a; color: #ffffff; padding: 12px 24px; "
        f"border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; "
        f"display: inline-block;'>Reset Kata Sandi</a>"
        f"</div>"
        f"<p style='color: #94a3b8; font-size: 12px;'>Jika tombol di atas tidak berfungsi, salin dan buka tautan berikut di browser:<br>"
        f"<a href='{reset_link}' style='color: #047857; word-break: break-all;'>{reset_link}</a></p>"
        f"<hr style='border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;'>"
        f"<p style='color: #94a3b8; font-size: 11px;'>Tautan reset ini berlaku selama 1 jam. Jika Anda tidak merasa meminta reset kata sandi, akun Anda tetap aman dan abaikan pesan ini.</p>"
        f"</div>"
    )

    return send_email(to_email, subject, text_content, html_content, settings)
