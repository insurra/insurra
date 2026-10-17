from enum import StrEnum
from uuid import UUID

from pydantic import model_validator

from app.schemas.common import Contract


class ActorType(StrEnum):
    DEMO_SESSION = "DEMO_SESSION"
    AUTHENTICATED_ACCOUNT = "AUTHENTICATED_ACCOUNT"


class Actor(Contract):
    actor_type: ActorType
    session_id: UUID | None = None
    account_id: UUID | None = None

    @model_validator(mode="after")
    def distinct_identity(self):
        demo = self.actor_type == ActorType.DEMO_SESSION
        if demo and (self.session_id is None or self.account_id is not None):
            raise ValueError("Demo identity requires only session_id")
        if not demo and (self.account_id is None or self.session_id is not None):
            raise ValueError("Account identity requires only account_id")
        return self
