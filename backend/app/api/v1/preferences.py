"""Actor-scoped notification and display preferences."""

from fastapi import APIRouter

from app.core.dependencies import DB
from app.core.errors import AppError
from app.schemas.preferences import (
    AVAILABLE_LANGUAGES,
    DisplayLanguage,
    LanguageOption,
    Preferences,
    PreferencesUpdate,
)
from app.services.preferences import (
    current_language,
    current_settings,
    preference_row,
    save_preferences,
)
from app.services.workspace import WorkspaceActor

router = APIRouter(prefix="/preferences", tags=["Preferences"])


def _view(db, actor) -> Preferences:
    row = preference_row(db, actor)
    return Preferences(
        **current_settings(db, actor),
        display_language=DisplayLanguage(current_language(db, actor)),
        languages=[
            LanguageOption(code=lang, available=lang in AVAILABLE_LANGUAGES)
            for lang in DisplayLanguage
        ],
        updated_at=row.updated_at if row else None,
    )


@router.get("", response_model=Preferences)
def get_preferences(db: DB, actor: WorkspaceActor):
    return _view(db, actor)


@router.put("", response_model=Preferences)
def put_preferences(body: PreferencesUpdate, db: DB, actor: WorkspaceActor):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    language = changes.pop("display_language", None)
    if language is not None and language not in AVAILABLE_LANGUAGES:
        raise AppError(
            422,
            "LANGUAGE_UNAVAILABLE",
            "This display language is not available yet.",
            {"available": [lang.value for lang in AVAILABLE_LANGUAGES]},
        )
    save_preferences(db, actor, changes, language.value if language else None)
    db.commit()
    return _view(db, actor)
