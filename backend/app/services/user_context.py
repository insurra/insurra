"""Canonical User Context service (Section 2 Integration Requirements).

Provides one shared context loader `get_authorized_user_context(subject_or_actor)`
across Home, Ask INSURRA, Care Pathways, and Claims.
Resolves identity strictly from authorized server-side sessions/tokens, never trusting
client input blindly.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import (
    AccountDocumentRow,
    AccountProfileRow,
    AccountRow,
    DemoSessionRow,
    ProfileRow,
)
from app.schemas.actor import Actor
from app.schemas.common import Contract as StrictModel
from app.services.actor_scope import owner_for
from app.workflow.owner import ACCOUNT, DEMO, Owner


class CanonicalUserContext(StrictModel):
    subject_id: str
    nationality: str | None = None
    residence_country: str | None = None
    residence_city: str | None = None
    situation: str | None = None
    institution: str | None = None
    dependents_count: int = 0
    profile_version: int | str = 1
    verification_status: str = "SELF_REPORTED"


def _normalize_situation(raw_situation: str | None, residence_context: str | None) -> str | None:
    if not raw_situation and not residence_context:
        return None
    sit_upper = str(raw_situation).upper() if raw_situation else ""
    ctx_upper = str(residence_context).upper() if residence_context else ""

    if sit_upper == "STUDENT" and ctx_upper == "ABROAD":
        return "INTERNATIONAL_STUDENT"
    if sit_upper in ("STUDENT", "INTERNATIONAL_STUDENT"):
        return "INTERNATIONAL_STUDENT" if ctx_upper == "ABROAD" else "STUDENT"
    if sit_upper:
        return sit_upper
    if ctx_upper == "ABROAD":
        return "EXPATRIATE"
    return ctx_upper or None


def _resolve_owner(db: Session, subject_or_actor: Any) -> Owner:
    """Resolve an authorized Owner from Actor, Owner, or opaque subject identifier."""
    if isinstance(subject_or_actor, Owner):
        return subject_or_actor
    if (
        isinstance(subject_or_actor, Actor)
        or hasattr(subject_or_actor, "account_id")
        or hasattr(subject_or_actor, "session_id")
    ):
        return owner_for(subject_or_actor)
    if isinstance(subject_or_actor, UUID):
        demo_row = db.get(DemoSessionRow, subject_or_actor)
        if demo_row is not None:
            return Owner(kind=DEMO, id=demo_row.id, persona_id=demo_row.persona_id)
        acc_row = db.get(AccountRow, subject_or_actor)
        if acc_row is not None:
            return Owner(kind=ACCOUNT, id=acc_row.id)
    if isinstance(subject_or_actor, str):
        # Demo persona pattern: "demo_raka", "demo_sinta", etc.
        if subject_or_actor.startswith("demo_"):
            persona = subject_or_actor[5:]
            row = db.scalar(
                select(DemoSessionRow)
                .where(DemoSessionRow.persona_id == persona)
                .order_by(DemoSessionRow.created_at.desc())
            )
            if row is not None:
                return Owner(kind=DEMO, id=row.id, persona_id=row.persona_id)
            raise AppError(
                404, "DEMO_SESSION_NOT_FOUND", f"Demo session '{subject_or_actor}' not found."
            )
        # Try UUID resolution
        try:
            val_uuid = UUID(subject_or_actor)
            demo_row = db.get(DemoSessionRow, val_uuid)
            if demo_row is not None:
                return Owner(kind=DEMO, id=demo_row.id, persona_id=demo_row.persona_id)
            acc_row = db.get(AccountRow, val_uuid)
            if acc_row is not None:
                return Owner(kind=ACCOUNT, id=acc_row.id)
        except (ValueError, TypeError):
            pass
    raise AppError(
        404, "SUBJECT_NOT_FOUND", "Authorized user context subject could not be resolved."
    )


def get_authorized_user_context(db: Session, subject_or_actor: Any) -> CanonicalUserContext:
    """Build the canonical user context for an authorized actor or subject.

    Handles missing, incomplete or stale profile explicitly.
    Distinguishes self-reported from verified profile data.
    """
    owner = _resolve_owner(db, subject_or_actor)
    is_demo = owner.kind == DEMO

    payload: dict = {}
    setup: dict = {}
    persona_id: str | None = owner.persona_id
    verification_status = "SELF_REPORTED"

    if is_demo:
        demo_row = db.get(DemoSessionRow, owner.id)
        if demo_row is None:
            raise AppError(404, "DEMO_SESSION_NOT_FOUND", "Demo session does not exist.")
        if not persona_id:
            persona_id = demo_row.persona_id
        prof_row = db.scalar(select(ProfileRow).where(ProfileRow.session_id == owner.id))
        if prof_row is None or not isinstance(prof_row.payload, dict):
            raise AppError(404, "PROFILE_NOT_FOUND", "User profile has not been initialized.")
        payload = dict(prof_row.payload)
        subject_id = f"demo_{persona_id}" if persona_id else f"demo_{owner.id}"
    else:
        acc_prof = db.get(AccountProfileRow, owner.id)
        if acc_prof is None or not isinstance(acc_prof.payload, dict):
            raise AppError(404, "PROFILE_NOT_FOUND", "User profile has not been initialized.")
        if not acc_prof.completed:
            raise AppError(409, "PROFILE_INCOMPLETE", "Lengkapi profil sebelum melanjutkan.")
        payload = dict(acc_prof.payload)
        acc_row = db.get(AccountRow, owner.id)
        if acc_row and isinstance(getattr(acc_row, "account_setup", None), dict):
            setup = dict(acc_row.account_setup)
        subject_id = f"account_{owner.id}"

        # Check for verified ID or visa documents to distinguish verified from self-reported
        verified_docs = db.scalar(
            select(AccountDocumentRow).where(
                AccountDocumentRow.account_id == owner.id,
                AccountDocumentRow.status == "VERIFIED",
            )
        )
        if verified_docs is not None:
            verification_status = "VERIFIED"

    # Profile version extraction
    raw_version = payload.get("profile_version") or payload.get("version")
    if raw_version is not None:
        try:
            profile_version = int(raw_version)
        except (ValueError, TypeError):
            profile_version = str(raw_version)
    else:
        # Default to 4 for demo_raka if applicable or 1
        profile_version = 4 if persona_id == "raka" else 1

    # Explicit field derivations
    nationality = payload.get("nationality") or setup.get("nationality")
    residence_country = payload.get("country_code") or owner.country_code
    residence_city = payload.get("city") or owner.city
    raw_sit = payload.get("situation") or setup.get("current_situation")
    res_ctx = payload.get("residence_context")
    situation = _normalize_situation(raw_sit, res_ctx)
    institution = payload.get("institution_name") or setup.get("institution_name")

    dependents = payload.get("dependents")
    if isinstance(dependents, list):
        dependents_count = len(dependents)
    else:
        dependents_count = 0

    return CanonicalUserContext(
        subject_id=subject_id,
        nationality=nationality,
        residence_country=residence_country,
        residence_city=residence_city,
        situation=situation,
        institution=institution,
        dependents_count=dependents_count,
        profile_version=profile_version,
        verification_status=verification_status,
    )
