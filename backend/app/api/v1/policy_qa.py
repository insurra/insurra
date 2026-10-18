"""Account/demo policy Q&A, guarded named SSE events and scoped source access."""

import asyncio
import json
import threading
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Path, Request
from fastapi.responses import StreamingResponse

from app.core.dependencies import DB, KB
from app.core.errors import AppError
from app.schemas.common import ApiError
from app.schemas.foundation import AskAnswer, AskRequest, ChatHistory, EmergencyRedirect
from app.schemas.valen import AnswerFeedback, SavedDecision, SourcePage
from app.services.evidence import retained_page
from app.services.policy_qa import answer, owned_chat, prepare, save_answer
from app.services.workspace import (
    WorkspaceActor,
    coverages,
    grants,
    require_grants,
    workspace_actor,
)
from app.services.workspace import (
    profile as current_profile,
)

router = APIRouter(
    tags=["Policy Q&A"], responses={429: {"model": ApiError}, 502: {"model": ApiError}}
)


def encode_event(event, data):
    value = data.model_dump(mode="json") if hasattr(data, "model_dump") else data
    payload = json.dumps({"event": event, "data": value}, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


@router.post(
    "/ask",
    response_model=AskAnswer | EmergencyRedirect,
    responses={
        200: {
            "content": {
                "text/event-stream": {
                    "schema": {"type": "string"},
                    "description": (
                        "Named SSE events with JSON AskStreamEvent payloads and comment heartbeats."
                    ),
                }
            }
        }
    },
)
async def ask(body: AskRequest, request: Request, db: DB, kb: KB, actor: WorkspaceActor):
    redirect = prepare(db, actor, kb, body)
    stream = "text/event-stream" in request.headers.get("accept", "")
    settings = request.app.state.settings
    factory = getattr(request.app.state, "qna_gateway_factory", None)
    cancelled = threading.Event()

    def generate():
        with request.app.state.session_factory() as connection:
            # Resolve the existing opaque session again; no token/actor ID is trusted from a body.
            current = workspace_actor(
                connection,
                request.headers.get("authorization"),
                request.headers.get("x-demo-session"),
            )
            return answer(connection, current, kb, body, settings, factory, cancelled)

    def persist(result):
        with request.app.state.session_factory() as connection:
            current = workspace_actor(
                connection,
                request.headers.get("authorization"),
                request.headers.get("x-demo-session"),
            )
            save_answer(connection, current, kb, body, result)

    if not stream:
        if redirect:
            return redirect
        result = await asyncio.to_thread(generate)
        if isinstance(result, AskAnswer):
            persist(result)
        return result

    async def events():
        task = None
        try:
            if redirect:
                yield encode_event("redirect", redirect)
                return
            yield encode_event("progress", {"stage": "retrieving"})
            task = asyncio.create_task(asyncio.to_thread(generate))
            while not task.done():
                done, _ = await asyncio.wait({task}, timeout=1)
                if await request.is_disconnected():
                    cancelled.set()
                    return
                if not done:
                    yield ": keepalive\n\n"
            result = await task
            if isinstance(result, EmergencyRedirect):
                yield encode_event("redirect", result)
                return
            yield encode_event("progress", {"stage": "validating"})
            for point in result.answer_points:
                if await request.is_disconnected():
                    cancelled.set()
                    return
                with request.app.state.session_factory() as connection:
                    current = workspace_actor(
                        connection,
                        request.headers.get("authorization"),
                        request.headers.get("x-demo-session"),
                    )
                    require_grants(connection, current, ai=True)
                    if (
                        current_profile(connection, current).country_code
                        != result.context_country_code
                    ):
                        raise AppError(
                            409, "CONTEXT_CHANGED", "Konteks berubah; mulai pertanyaan baru."
                        )
                yield encode_event("answer_point", point)
            if not await request.is_disconnected():
                persist(result)
                yield encode_event("complete", result)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        except AppError as exc:
            yield encode_event(
                "error",
                ApiError(
                    code=exc.code,
                    message=exc.message,
                    details=exc.details,
                    request_id=request.state.request_id,
                ),
            )
        except Exception:
            yield encode_event(
                "error",
                ApiError(
                    code="ANSWER_UNAVAILABLE",
                    message="Belum bisa menjawab. Coba ulangi.",
                    request_id=request.state.request_id,
                ),
            )
        finally:
            cancelled.set()
            if task and not task.done():
                task.cancel()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"},
    )


@router.get("/ask/sessions/{chat_session_id}", response_model=ChatHistory)
def history(chat_session_id: UUID, db: DB, actor: WorkspaceActor):
    require_grants(db, actor, ai=True)
    row = owned_chat(db, actor, chat_session_id)
    turns = (
        [
            {"id": t["id"], "question": t["question"], "answer": t["answer"]}
            for t in row.turns
            if "question" in t
            and "answer" in t
            and t.get("country_code") == current_profile(db, actor).country_code
        ]
        if grants(db, actor).get("retention")
        else []
    )
    return ChatHistory(chat_session_id=row.id, turns=turns[-10:])


@router.delete("/ask/sessions/{chat_session_id}", response_model=SavedDecision)
def clear_history(chat_session_id: UUID, db: DB, actor: WorkspaceActor):
    db.delete(owned_chat(db, actor, chat_session_id))
    db.commit()
    return SavedDecision()


@router.post("/ask/sessions/{chat_session_id}/feedback", response_model=SavedDecision)
def feedback(chat_session_id: UUID, body: AnswerFeedback, db: DB, actor: WorkspaceActor):
    row = owned_chat(db, actor, chat_session_id)
    turns = [dict(t) for t in row.turns]
    turn = next((t for t in turns if t["id"] == str(body.answer_id)), None)
    if turn is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Jawaban tidak ditemukan.")
    turn["feedback"] = {"helpful": body.helpful, "reason": body.reason}
    row.turns = turns
    db.commit()
    return SavedDecision()


@router.get("/ask/sources/{document_id}/{page}", response_model=SourcePage)
def source(
    document_id: UUID,
    page: Annotated[int, Path(ge=1, le=30)],
    db: DB,
    kb: KB,
    actor: WorkspaceActor,
):
    require_grants(db, actor, ai=True)
    items = coverages(db, actor, kb)
    if not any(document_id in c.document_ids for c in items):
        raise AppError(404, "RESOURCE_NOT_FOUND", "Sumber tidak ditemukan.")
    row = retained_page(db, actor, document_id, page)
    if row is None:
        raise AppError(
            409,
            "SOURCE_NOT_RETAINED",
            "Halaman sumber tidak tersedia. Periksa persetujuan atau unggah ulang dokumen.",
        )
    return SourcePage(document_id=document_id, page=page, text=row.text)
