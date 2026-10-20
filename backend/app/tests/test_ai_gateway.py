import json
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from openai import OpenAI, OpenAIError
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.schemas.chat import PolicyAnswer
from app.services.account_documents import (
    ExtractionResult,
    PageText,
    _ocr_language,
    extract_to_schema,
)
from app.services.ai_gateway import GEMINI_BASE_URL, GeminiGateway
from app.services.policy_qa import ModelAnswer


def parsed_result(value):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=value))])


def test_gateway_requires_gemini_key_without_a_network_call():
    with pytest.raises(AppError) as exc:
        GeminiGateway(Settings(gemini_api_key=""))
    assert exc.value.code == "AI_NOT_CONFIGURED"


def test_settings_rejects_unimplemented_provider():
    with pytest.raises(ValidationError):
        Settings(ai_provider="openai")


def test_default_models_use_the_live_verified_gemini_model(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    for name in ("GEMINI_MODEL", "GEMINI_FAST_MODEL"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)
    assert settings.ai_provider == "gemini"
    assert settings.gemini_model == "gemini-3.5-flash-lite"
    assert settings.gemini_fast_model == "gemini-3.5-flash-lite"


@pytest.mark.parametrize(
    ("output", "expected"),
    [
        (b"List of available languages (2):\neng\nosd\n", "eng"),
        (b"List of available languages (3):\neng\nind\nosd\n", "eng+ind"),
    ],
)
def test_ocr_uses_installed_english_and_indonesian_languages(monkeypatch, output, expected):
    monkeypatch.setattr("app.services.account_documents._run", lambda *_args, **_kwargs: output)
    _ocr_language.cache_clear()
    assert _ocr_language() == expected
    _ocr_language.cache_clear()


def test_gateway_uses_gemini_chat_completions_and_structured_output(monkeypatch):
    client = Mock()
    parsed = PolicyAnswer(
        answer="Synthetic test only",
        certainty="NEEDS_CONFIRMATION",
        citations=[],
        requires_human_confirmation=True,
        warnings=[],
    )
    client.beta.chat.completions.parse.return_value = parsed_result(parsed)
    factory = Mock(return_value=client)
    monkeypatch.setattr("app.services.ai_gateway.OpenAI", factory)
    settings = Settings(
        gemini_api_key="synthetic-test-key",
        gemini_model="configured-primary",
        gemini_fast_model="configured-fast",
    )
    gateway = GeminiGateway(settings)
    factory.assert_called_once_with(
        api_key="synthetic-test-key",
        base_url=GEMINI_BASE_URL,
        max_retries=0,
        timeout=20.0,
    )
    for fast, model in [(False, "configured-primary"), (True, "configured-fast")]:
        assert (
            gateway.parse(
                instructions="Test", text="Synthetic", output_type=PolicyAnswer, fast=fast
            )
            == parsed
        )
        client.beta.chat.completions.parse.assert_called_with(
            model=model,
            messages=[
                {"role": "system", "content": "Test"},
                {"role": "user", "content": "Synthetic"},
            ],
            response_format=PolicyAnswer,
        )
    assert not client.responses.called


def test_gemini_sdk_sends_chat_completion_json_schema(monkeypatch):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "id": "synthetic-completion",
                "object": "chat.completion",
                "created": 0,
                "model": "gemini-3.5-flash-lite",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": '{"answer_points":[]}'},
                    }
                ],
            },
        )

    transport = httpx.MockTransport(respond)
    monkeypatch.setattr(
        "app.services.ai_gateway.OpenAI",
        lambda **kwargs: OpenAI(**kwargs, http_client=httpx.Client(transport=transport)),
    )
    gateway = GeminiGateway(
        Settings(gemini_api_key="synthetic-test-key", gemini_model="gemini-3.5-flash-lite")
    )
    result = gateway.parse(instructions="Evidence only", text="Synthetic", output_type=ModelAnswer)
    assert result == ModelAnswer(answer_points=[])
    assert len(requests) == 1
    assert requests[0].url.path == "/v1beta/openai/chat/completions"
    payload = json.loads(requests[0].content)
    assert payload["model"] == "gemini-3.5-flash-lite"
    assert payload["messages"] == [
        {"role": "system", "content": "Evidence only"},
        {"role": "user", "content": "Synthetic"},
    ]
    assert payload["response_format"]["type"] == "json_schema"


@pytest.mark.parametrize(
    "result",
    [
        parsed_result(None),
        SimpleNamespace(choices=[]),
        SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace())]),
    ],
)
def test_gateway_rejects_missing_structured_output(monkeypatch, result):
    client = Mock()
    client.beta.chat.completions.parse.return_value = result
    monkeypatch.setattr("app.services.ai_gateway.OpenAI", lambda **kwargs: client)
    gateway = GeminiGateway(Settings(gemini_api_key="synthetic-test-key"))
    with pytest.raises(AppError) as exc:
        gateway.parse(instructions="Test", text="Synthetic", output_type=PolicyAnswer)
    assert exc.value.code == "AI_OUTPUT_UNAVAILABLE"


def test_gateway_masks_provider_and_validation_failures(monkeypatch):
    client = Mock()
    monkeypatch.setattr("app.services.ai_gateway.OpenAI", lambda **kwargs: client)
    gateway = GeminiGateway(Settings(gemini_api_key="synthetic-test-key"))
    client.beta.chat.completions.parse.side_effect = OpenAIError("secret provider response")
    with pytest.raises(AppError) as exc:
        gateway.parse(instructions="Test", text="Synthetic", output_type=PolicyAnswer)
    assert exc.value.code == "AI_UNAVAILABLE" and "secret" not in exc.value.message
    client.beta.chat.completions.parse.side_effect = ValueError("secret malformed response")
    with pytest.raises(AppError) as exc:
        gateway.parse(instructions="Test", text="Synthetic", output_type=PolicyAnswer)
    assert exc.value.code == "AI_OUTPUT_UNAVAILABLE" and "secret" not in exc.value.message


def test_document_extraction_uses_fast_gemini_model_only_with_configured_key(monkeypatch):
    template = SimpleNamespace(
        document_type="policy", fields=[SimpleNamespace(field_key="provider")]
    )
    country = SimpleNamespace(
        resources=SimpleNamespace(extraction_templates=SimpleNamespace(data=[template]))
    )
    pages = [PageText(page_no=1, text="Provider: Synthetic", ocr_used=False)]
    gateway = Mock()
    gateway.parse.return_value = ExtractionResult(
        fields=[{"field_key": "provider", "value": "Synthetic", "source_page": 1}]
    )
    factory = Mock(return_value=gateway)
    monkeypatch.setattr("app.services.account_documents.GeminiGateway", factory)
    result = extract_to_schema(
        pages, country, "policy", Settings(gemini_api_key="synthetic-test-key")
    )
    assert result.fields[0].value == "Synthetic"
    assert gateway.parse.call_args.kwargs["fast"] is True
    assert gateway.parse.call_args.kwargs["output_type"] is ExtractionResult
    factory.reset_mock()
    extract_to_schema(pages, country, "policy", Settings(gemini_api_key=""))
    factory.assert_not_called()


@pytest.mark.parametrize(
    ("country_code", "document_type"),
    [
        ("AU", "policy_booklet"),
        ("AU", "oshc_certificate"),
        ("AU", "insurance_card"),
        ("ID", "policy_booklet"),
        ("ID", "insurance_card"),
    ],
)
def test_versioned_policy_templates_allow_only_source_backed_summary_fields(
    app, country_code, document_type
):
    country = app.state.kb_loader.load(country_code)
    template = next(
        item
        for item in country.resources.extraction_templates.data
        if item.document_type == document_type
    )
    assert {field.field_key for field in template.fields} == {
        "provider",
        "coverage_start_date",
        "coverage_end_date",
    }
    assert country.resources.extraction_templates.verification_status == "UNVERIFIED"
