from fastapi import APIRouter

from app.api import auth
from app.api.v1 import (
    account_documents,
    account_workspace,
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
router.include_router(auth.api_router)
router.include_router(auth.account_auth_router)
router.include_router(account_workspace.router)
router.include_router(account_documents.router)
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
