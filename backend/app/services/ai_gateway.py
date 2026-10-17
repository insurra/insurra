"""Phase 2 integration seam. Never instantiated or called by Phase 1 routes."""

from openai import OpenAI
from pydantic import BaseModel

from app.core.config import Settings
from app.core.errors import AppError


class ResponsesGateway:
    def __init__(self, settings: Settings):
        if not settings.openai_api_key.get_secret_value():
            raise AppError(503, "AI_NOT_CONFIGURED", "Integrasi AI belum dikonfigurasi.")
        self.settings = settings
        self.client = OpenAI(api_key=settings.openai_api_key.get_secret_value())

    def parse(self, *, instructions: str, text: str, output_type: type[BaseModel], fast=False):
        # The caller must apply session, consent, input and citation guards in Phase 2.
        result = self.client.responses.parse(
            model=self.settings.openai_fast_model if fast else self.settings.openai_model,
            instructions=instructions,
            input=text,
            text_format=output_type,
            store=False,
        )
        if result.output_parsed is None:
            raise AppError(
                502, "AI_OUTPUT_UNAVAILABLE", "Tidak ada keluaran terstruktur yang valid."
            )
        return result.output_parsed
