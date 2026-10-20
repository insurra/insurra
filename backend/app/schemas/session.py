from datetime import datetime
from uuid import UUID

from pydantic import Field, StrictBool

from app.schemas.actor import Actor
from app.schemas.common import Contract, CountryCode


class DemoPersona(Contract):
    persona_id: str
    display_name: str
    country_code: CountryCode
    description: str
    synthetic: bool = True
    city: str | None = None
    role_label: str | None = None
    insurance_categories: list[str] = Field(default_factory=list)
    is_synthetic: bool = True


class SessionCreate(Contract):
    persona_id: str = Field(min_length=1, max_length=50)


class DemoSession(Contract):
    id: UUID
    persona_id: str
    profile_id: UUID
    created_at: datetime
    expires_at: datetime
    actor: Actor


class SessionCreated(DemoSession):
    session_token: str


class ConsentUpdate(Contract):
    processing_consent: StrictBool


class ConsentState(ConsentUpdate):
    updated_at: datetime
