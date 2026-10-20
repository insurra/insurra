from datetime import datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import StrictBool

from app.schemas.common import Contract

POLICY_VERSION = "1.5"


class ConsentPurpose(StrEnum):
    PROCESS_DOCUMENTS = "process_documents"
    EXTERNAL_AI = "external_ai"
    RETENTION = "retention"
    HEALTH_PROFILE = "health_profile"


class PurposeConsentUpdate(Contract):
    purpose: ConsentPurpose
    granted: StrictBool
    policy_version: Literal["1.5"] = POLICY_VERSION


class PurposeConsent(Contract):
    id: UUID
    purpose: ConsentPurpose
    granted: bool
    policy_version: str
    granted_at: datetime | None
    revoked_at: datetime | None
    updated_at: datetime
