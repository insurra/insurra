"""In-app notifications: static templates, owner scoping, preference checks and dedupe.

Titles and bodies come only from the static table below. They never contain medical details,
document values, amounts or names. `emit` runs in the caller's transaction and ignores a
duplicate dedupe key instead of raising.
"""

import re
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import NotificationRow
from app.services.actor_scope import owner_values, owner_where
from app.services.preferences import current_settings

CATEGORIES = ("ACTION_REQUIRED", "CLAIMS", "PROTECTION", "SYSTEM")
PRIORITIES = ("LOW", "NORMAL", "HIGH")
_LINK = re.compile(r"^/[A-Za-z0-9_\-./]*$")
_ENTITY = re.compile(r"^[A-Za-z0-9_\-:.]{1,64}$")


@dataclass(frozen=True)
class Template:
    category: str
    priority: str
    title: str
    body: str
    link: str | None = None
    setting: str | None = None  # preference toggle that can suppress it
    mandatory: bool = False  # security or consent notices cannot be disabled
    entity_type: str | None = None


_OUTCOME = Template(
    "CLAIMS",
    "NORMAL",
    "Sandbox claim outcome",
    "A sandbox claim has an outcome. This is a simulation, not a real insurer decision.",
    "/claims/{id}",
    "claim_updates",
    entity_type="claim",
)

TEMPLATES: dict[str, Template] = {
    "onboarding.completed": Template(
        "SYSTEM",
        "LOW",
        "Profile ready",
        "Your profile is saved. You can now add documents and review your coverage.",
        "/home",
        entity_type="account",
    ),
    "document.extraction.completed": Template(
        "PROTECTION",
        "NORMAL",
        "Document processed",
        "A document finished processing. Open it to check what was found.",
        "/account/documents/{id}",
        entity_type="document",
    ),
    "document.review.required": Template(
        "ACTION_REQUIRED",
        "NORMAL",
        "Review document details",
        "Some details need your confirmation before INSURRA relies on them.",
        "/account/documents/{id}",
        "reminders",
        entity_type="document",
    ),
    "document.extraction.failed": Template(
        "ACTION_REQUIRED",
        "NORMAL",
        "Document needs attention",
        "A document could not be fully processed. Open it to see your options.",
        "/account/documents/{id}",
        "reminders",
        entity_type="document",
    ),
    "claim.created": Template(
        "CLAIMS",
        "NORMAL",
        "Claim case created",
        "Add evidence to keep your claim case moving.",
        "/claims/{id}",
        "claim_updates",
        entity_type="claim",
    ),
    "claim.status.ADDITIONAL_INFO_REQUIRED": Template(
        "ACTION_REQUIRED",
        "HIGH",
        "More information requested",
        "The sandbox insurer asked for more information on a claim case.",
        "/claims/{id}",
        "reminders",
        entity_type="claim",
    ),
    "claim.status.APPROVED_IN_SANDBOX": _OUTCOME,
    "claim.status.REJECTED_IN_SANDBOX": _OUTCOME,
    "action.prepared": Template(
        "ACTION_REQUIRED",
        "HIGH",
        "Approval needed",
        "INSURRA prepared an action that waits for your approval. Nothing runs until you approve.",
        "/actions",
        "reminders",
        entity_type="action",
    ),
    "action.approved": Template(
        "CLAIMS",
        "LOW",
        "Action approved",
        "Your approval is recorded for the exact content you reviewed.",
        "/actions",
        "claim_updates",
        entity_type="action",
    ),
    "action.executed": Template(
        "CLAIMS",
        "NORMAL",
        "Action completed",
        "An approved action finished. Open the receipt to see what was and was not sent.",
        "/actions",
        "claim_updates",
        entity_type="action",
    ),
    "reminder.due": Template(
        "PROTECTION",
        "NORMAL",
        "Coverage ends soon",
        "A coverage on your account ends within 30 days. Review it to avoid a gap.",
        "/policies",
        "renewal_alerts",
        entity_type="coverage",
    ),
    "consent.revoked": Template(
        "SYSTEM",
        "NORMAL",
        "Permission turned off",
        "A data permission was turned off. Related stored content was removed where applicable.",
        "/account/privacy",
        mandatory=True,
        entity_type="consent",
    ),
}


def safe_deep_link(link: str | None) -> str | None:
    """Only in-app relative paths are allowed: no scheme, host, protocol-relative or traversal."""
    if link is None:
        return None
    if not _LINK.fullmatch(link) or "//" in link or ".." in link or len(link) > 300:
        raise ValueError("deep_link must be an in-app relative path")
    return link


def _allowed(db: Session, actor, template: Template) -> bool:
    if template.mandatory:
        return True
    settings = current_settings(db, actor)
    if not settings["in_app_alerts"]:
        return False
    return settings[template.setting] if template.setting else True


def emit_outcome(
    db: Session,
    actor,
    template_key: str,
    *,
    entity_id: str | UUID | None,
    dedupe_key: str,
    event_source: str | None = None,
) -> tuple[str, NotificationRow | None]:
    """Returns ("created"|"duplicate"|"suppressed", row)."""
    template = TEMPLATES[template_key]
    ref = str(entity_id) if entity_id is not None else None
    if ref is not None and not _ENTITY.fullmatch(ref):
        raise ValueError("invalid entity reference")
    dedupe_key = dedupe_key[:200]
    existing = db.scalar(
        select(NotificationRow).where(
            owner_where(NotificationRow, actor), NotificationRow.dedupe_key == dedupe_key
        )
    )
    if existing is not None:
        return "duplicate", existing
    if not _allowed(db, actor, template):
        return "suppressed", None
    link = template.link.format(id=ref) if template.link and "{id}" in template.link else None
    row = NotificationRow(
        **owner_values(actor),
        type=template_key,
        category=template.category,
        priority=template.priority,
        title=template.title,
        body=template.body,
        entity_type=template.entity_type,
        entity_id=ref,
        deep_link=safe_deep_link(link or template.link),
        event_source=(event_source or template_key.split(".")[0])[:60],
        dedupe_key=dedupe_key,
    )
    try:
        with db.begin_nested():
            db.add(row)
    except IntegrityError:  # concurrent insert of the same key
        return "duplicate", None
    return "created", row


def emit(
    db: Session,
    actor,
    template_key: str,
    *,
    entity_id: str | UUID | None = None,
    dedupe_key: str,
    event_source: str | None = None,
) -> NotificationRow | None:
    """Insert-or-ignore on the owner's dedupe key. Returns the new row or None."""
    status, row = emit_outcome(
        db,
        actor,
        template_key,
        entity_id=entity_id,
        dedupe_key=dedupe_key,
        event_source=event_source,
    )
    return row if status == "created" else None
