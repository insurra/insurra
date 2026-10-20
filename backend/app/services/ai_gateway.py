"""Configured Responses boundary; callers enforce current actor/consent/evidence guards."""

import json
import ssl
import urllib.error
import urllib.request

from openai import OpenAI
from pydantic import BaseModel

from app.core.config import Settings
from app.core.errors import AppError


class ResponsesGateway:
    def __init__(self, settings: Settings):
        has_openai = bool(settings.openai_api_key.get_secret_value())
        has_gemini = bool(settings.gemini_api_key.get_secret_value())
        if not has_openai and not has_gemini:
            raise AppError(503, "AI_NOT_CONFIGURED", "Integrasi AI belum dikonfigurasi.")
        self.settings = settings
        if has_openai:
            self.client = OpenAI(
                api_key=settings.openai_api_key.get_secret_value(), max_retries=0, timeout=20.0
            )
        else:
            self.client = None

    def parse(self, *, instructions: str, text: str, output_type: type[BaseModel], fast=False):
        # Callers apply current actor, consent, input and citation guards.
        if self.client is not None:
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

        return self._parse_gemini(instructions=instructions, text=text, output_type=output_type)

    def _parse_gemini(self, *, instructions: str, text: str, output_type: type[BaseModel]):
        api_key = self.settings.gemini_api_key.get_secret_value()
        model = self.settings.gemini_model or "gemini-3.5-flash-lite"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

        payload = {
            "system_instruction": {"parts": [{"text": instructions}]},
            "contents": [{"parts": [{"text": text}]}],
            "generationConfig": {
                "thinkingConfig": {"thinkingLevel": "low"},
                "responseFormat": {
                    "text": {
                        "mimeType": "APPLICATION_JSON",
                        "schema": output_type.model_json_schema(),
                    }
                },
            },
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
            method="POST",
        )
        try:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = True
            context.verify_mode = ssl.CERT_REQUIRED
            context.load_default_certs()
            with urllib.request.urlopen(req, timeout=25.0, context=context) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                candidates = data.get("candidates", [])
                if not candidates:
                    raise AppError(
                        502, "AI_OUTPUT_UNAVAILABLE", "Tidak ada keluaran dari model AI."
                    )
                parts = candidates[0].get("content", {}).get("parts", [])
                if not parts:
                    raise AppError(
                        502, "AI_OUTPUT_UNAVAILABLE", "Tidak ada keluaran teks dari model."
                    )
                response_text = "".join(
                    part.get("text", "") for part in parts if isinstance(part, dict)
                )
                if not response_text:
                    raise AppError(
                        502, "AI_OUTPUT_UNAVAILABLE", "Tidak ada keluaran teks dari model."
                    )
                return output_type.model_validate_json(response_text)
        except urllib.error.HTTPError as exc:
            raise AppError(502, "AI_UPSTREAM_ERROR", f"Gemini error: {exc.code}") from exc
        except TimeoutError as exc:
            raise AppError(
                503, "AI_UNAVAILABLE", "Layanan AI tidak merespons tepat waktu."
            ) from exc
        except AppError:
            raise
        except Exception as exc:
            raise AppError(
                502, "AI_OUTPUT_UNAVAILABLE", "Keluaran AI tidak dapat divalidasi."
            ) from exc
