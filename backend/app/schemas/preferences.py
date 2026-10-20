from datetime import datetime
from enum import StrEnum

from app.schemas.common import Contract


class DisplayLanguage(StrEnum):
    EN = "en"
    ZH = "zh"
    ID = "id"


# Only English ships now; the other codes are reserved and rejected on write.
AVAILABLE_LANGUAGES = (DisplayLanguage.EN,)


class LanguageOption(Contract):
    code: DisplayLanguage
    available: bool


class Preferences(Contract):
    in_app_alerts: bool
    reminders: bool
    claim_updates: bool
    renewal_alerts: bool
    display_language: DisplayLanguage
    external_ai_disclosure_acknowledged: bool
    languages: list[LanguageOption]
    updated_at: datetime | None = None


class PreferencesUpdate(Contract):
    in_app_alerts: bool | None = None
    reminders: bool | None = None
    claim_updates: bool | None = None
    renewal_alerts: bool | None = None
    display_language: DisplayLanguage | None = None
    external_ai_disclosure_acknowledged: bool | None = None
