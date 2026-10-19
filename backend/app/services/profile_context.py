"""Active-country gate and the unified read model behind GET /api/v1/context."""

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import (
    AccountDocumentRow,
    AccountFieldRow,
    AccountProfileRow,
    AccountRow,
    DemoSessionRow,
)
from app.repositories.session_data import insurance_row, profile_row
from app.schemas.actor import Actor
from app.schemas.insurance import UnifiedInsuranceRecord
from app.schemas.user_context import ContextMode, UserContext
from app.services.kb_loader import CountryKBLoader
from app.services.workspace import coverages


def active_country_codes(request: Request) -> set[str]:
    raw = getattr(request.app.state.settings, "active_kb_countries", "CN,ID")
    return {code.strip().upper() for code in str(raw).split(",") if code.strip()}


def require_active_country(request: Request, country_code: str) -> None:
    if country_code not in active_country_codes(request):
        raise AppError(422, "UNSUPPORTED_COUNTRY", "Negara belum tersedia dalam basis pengetahuan.")


def _default_currency(kb: CountryKBLoader, country_code: str | None) -> str | None:
    if not country_code:
        return None
    try:
        value = getattr(kb.load(country_code).manifest, "default_currency", None)
    except Exception:
        return None
    return value if isinstance(value, str) else None


def _coverage_verified(db: Session, actor: Actor, kb: CountryKBLoader) -> bool:
    try:
        return any(item.verified for item in coverages(db, actor, kb))
    except Exception:
        return False


def build_context(db: Session, actor: Actor, kb: CountryKBLoader) -> UserContext:
    if actor.account_id:
        account = db.get(AccountRow, actor.account_id)
        row = db.get(AccountProfileRow, actor.account_id)
        payload = row.payload if row else {}
        completed = bool(row and row.completed)
        owner = AccountDocumentRow.account_id == actor.account_id
        documents = db.scalar(select(func.count()).select_from(AccountDocumentRow).where(owner))
        field_owner = AccountFieldRow.account_id == actor.account_id
        extracted = db.scalar(
            select(func.count())
            .select_from(AccountFieldRow)
            .where(field_owner, AccountFieldRow.value.is_not(None))
        )
        reviewed = db.scalar(
            select(func.count())
            .select_from(AccountFieldRow)
            .where(field_owner, AccountFieldRow.confirmed_by_user.is_(True))
        )
        mode, persona_id = ContextMode.ACCOUNT, None
        email, verified = account.email, bool(account.email_verified)
        name = payload.get("display_name") or account.display_name
    else:
        payload = profile_row(db, actor.session_id).payload
        session = db.get(DemoSessionRow, actor.session_id)
        record = UnifiedInsuranceRecord.model_validate(insurance_row(db, actor.session_id).payload)
        completed = True
        documents, extracted, reviewed = len(record.documents), 0, 0
        mode, persona_id, email, verified = ContextMode.DEMO, session.persona_id, None, False
        name = payload.get("display_name")
    country = payload.get("country_code")
    declared = list(payload.get("owned_coverage") or [])
    return UserContext(
        mode=mode,
        is_synthetic=mode == ContextMode.DEMO,
        persona_id=persona_id,
        display_name=name,
        email=email,
        email_verified=verified,
        residence_country=country,
        city=payload.get("city"),
        currency=payload.get("currency") or _default_currency(kb, country),
        situation=payload.get("situation"),
        onboarding_completed=completed,
        declared_insurance_categories=declared,
        goals=list(payload.get("goals") or []),
        profile_completed=completed,
        insurance_declared=bool(declared),
        documents_uploaded=documents or 0,
        fields_extracted=extracted or 0,
        fields_reviewed=reviewed or 0,
        coverage_verified=_coverage_verified(db, actor, kb),
    )
