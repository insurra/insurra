from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile

from app.core.dependencies import AISession, ConsentedSession
from app.core.errors import not_implemented
from app.schemas.document import Document

router = APIRouter(prefix="/documents", tags=["Documents"])


@router.get("", response_model=list[Document])
def documents(session: ConsentedSession):
    not_implemented()


@router.post("/upload", response_model=Document, status_code=202)
def upload(
    session: AISession,
    file: Annotated[UploadFile, File(description="Policy/document file; not processed in Phase 1")],
    document_type: Annotated[str, Form(min_length=1, max_length=100)] = "INSURANCE_POLICY",
):
    not_implemented()
