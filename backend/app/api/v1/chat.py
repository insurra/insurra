from fastapi import APIRouter

from app.core.dependencies import AISession
from app.core.errors import not_implemented
from app.schemas.chat import PolicyAnswer, PolicyQuestionRequest

router = APIRouter(prefix="/chat", tags=["Policy Q&A"])


@router.post("/ask", response_model=PolicyAnswer)
def ask(body: PolicyQuestionRequest, session: AISession):
    not_implemented()
