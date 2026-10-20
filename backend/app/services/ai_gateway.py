"""Gemini structured-output boundary; callers enforce actor/consent/evidence guards."""

from openai import OpenAI, OpenAIError
from pydantic import BaseModel, ValidationError

from app.core.config import Settings
from app.core.errors import AppError

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


class GeminiGateway:
    def __init__(self, settings: Settings):
        if not settings.gemini_api_key.get_secret_value():
            raise AppError(503, "AI_NOT_CONFIGURED", "Integrasi AI belum dikonfigurasi.")
        self.settings = settings
        self.client = OpenAI(
            api_key=settings.gemini_api_key.get_secret_value(),
            base_url=GEMINI_BASE_URL,
            max_retries=0,
            timeout=20.0,
        )

    def parse(self, *, instructions: str, text: str, output_type: type[BaseModel], fast=False):
        # Callers apply current actor, consent, input and citation guards.
        try:
            result = self.client.beta.chat.completions.parse(
                model=self.settings.gemini_fast_model if fast else self.settings.gemini_model,
                messages=[
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": text},
                ],
                response_format=output_type,
            )
        except OpenAIError:
            raise AppError(503, "AI_UNAVAILABLE", "Layanan AI belum tersedia.") from None
        except (ValidationError, ValueError):
            raise AppError(
                502, "AI_OUTPUT_UNAVAILABLE", "Tidak ada keluaran terstruktur yang valid."
            ) from None
        try:
            parsed = result.choices[0].message.parsed if result.choices else None
        except (AttributeError, IndexError, TypeError):
            parsed = None
        if parsed is None:
            raise AppError(
                502, "AI_OUTPUT_UNAVAILABLE", "Tidak ada keluaran terstruktur yang valid."
            )
        try:
            return output_type.model_validate(parsed)
        except ValidationError:
            raise AppError(
                502, "AI_OUTPUT_UNAVAILABLE", "Tidak ada keluaran terstruktur yang valid."
            ) from None
