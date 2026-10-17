from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.core.config import Settings
from app.core.errors import AppError
from app.schemas.chat import PolicyAnswer
from app.services.ai_gateway import ResponsesGateway


def test_gateway_requires_key_without_a_network_call():
    with pytest.raises(AppError) as exc:
        ResponsesGateway(Settings(openai_api_key=""))
    assert exc.value.code == "AI_NOT_CONFIGURED"


def test_gateway_uses_configured_responses_structured_output(monkeypatch):
    client = Mock()
    parsed = PolicyAnswer(
        answer="Synthetic test only",
        certainty="NEEDS_CONFIRMATION",
        citations=[],
        requires_human_confirmation=True,
        warnings=[],
    )
    client.responses.parse.return_value = SimpleNamespace(output_parsed=parsed)
    monkeypatch.setattr("app.services.ai_gateway.OpenAI", lambda **kwargs: client)
    settings = Settings(
        openai_api_key="synthetic-test-key",
        openai_model="configured-primary",
        openai_fast_model="configured-fast",
    )
    gateway = ResponsesGateway(settings)
    for fast, model in [(False, "configured-primary"), (True, "configured-fast")]:
        assert (
            gateway.parse(
                instructions="Test", text="Synthetic", output_type=PolicyAnswer, fast=fast
            )
            == parsed
        )
        client.responses.parse.assert_called_with(
            model=model,
            instructions="Test",
            input="Synthetic",
            text_format=PolicyAnswer,
            store=False,
        )
    client.responses.parse.return_value = SimpleNamespace(output_parsed=None)
    with pytest.raises(AppError) as exc:
        gateway.parse(instructions="Test", text="Synthetic", output_type=PolicyAnswer)
    assert exc.value.code == "AI_OUTPUT_UNAVAILABLE"
