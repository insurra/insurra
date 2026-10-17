from fastapi import APIRouter

from app.api.v1 import (
    actions,
    assessments,
    audit,
    care,
    chat,
    claims,
    consent,
    documents,
    foundation,
    insurance,
    profiles,
    sessions,
)
from app.core.errors import ERROR_RESPONSES

router = APIRouter(prefix="/api/v1", responses=ERROR_RESPONSES)
for module in (
    sessions,
    consent,
    profiles,
    documents,
    insurance,
    assessments,
    chat,
    care,
    claims,
    actions,
    audit,
    foundation,
):
    router.include_router(module.router)
