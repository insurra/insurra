from datetime import datetime

from pydantic import JsonValue

from app.schemas.common import Contract
from app.schemas.consent import ConsentPurpose


class ConsentHistoryItem(Contract):
    purpose: ConsentPurpose
    granted: bool
    policy_version: str | None = None
    timestamp: datetime


class ConsentHistory(Contract):
    items: list[ConsentHistoryItem]


class ConnectedSource(Contract):
    id: str
    name: str
    status: str


class ConnectedSources(Contract):
    items: list[ConnectedSource]
    reason: str


class AccountExport(Contract):
    schema_version: str
    generated_at: datetime
    notice: str
    profile: dict[str, JsonValue] | None
    consents: list[dict[str, JsonValue]]
    preferences: dict[str, JsonValue]
    documents: list[dict[str, JsonValue]]
    reviewed_fields: list[dict[str, JsonValue]]
    coverages: list[dict[str, JsonValue]]
    family_members: list[dict[str, JsonValue]]
    claim_cases: list[dict[str, JsonValue]]
    actions: list[dict[str, JsonValue]]
    notifications: list[dict[str, JsonValue]]
