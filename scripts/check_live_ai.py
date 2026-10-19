"""Opt-in provider connectivity only; no insurance or personal documents are sent."""

import argparse

from app.core.config import Settings
from app.core.errors import AppError
from app.services.ai_gateway import ResponsesGateway
from app.services.policy_qa import ModelAnswer
from openai import OpenAIError
from pydantic import ValidationError


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--live",
        action="store_true",
        help="Explicitly authorize one paid provider call",
    )
    args = parser.parse_args()
    if not args.live:
        parser.error("Use --live to explicitly opt in; this command never runs in CI")
    try:
        result = ResponsesGateway(Settings()).parse(
            instructions="Return an empty answer_points list. This is a synthetic connectivity check.",
            text="No personal, medical or insurance information is provided.",
            output_type=ModelAnswer,
        )
    except AppError as exc:
        raise SystemExit(f"Provider check unavailable: {exc.code}") from None
    except (OpenAIError, ValidationError, ValueError, TimeoutError):
        raise SystemExit(
            "Provider check unavailable; no provider details or credentials logged"
        ) from None
    print(
        f"Structured provider response received ({len(result.answer_points)} points)."
    )


if __name__ == "__main__":
    main()
