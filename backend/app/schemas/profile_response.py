from pydantic import Field

from app.schemas.common import Contract
from app.schemas.kb import SuggestedDocument
from app.schemas.profile import UserProfile


class ProfileResponse(Contract):
    profile: UserProfile
    suggested_docs: list[SuggestedDocument] = Field(max_length=6)
