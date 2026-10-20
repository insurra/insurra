"""Opt-in provider connectivity only; no insurance or personal documents are sent."""

import argparse
import sys
from pathlib import Path

from openai import OpenAIError
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.core.config import Settings
from app.core.errors import AppError
from app.services.ai_gateway import GeminiGateway
from app.services.policy_qa import ModelAnswer


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--live",
        action="store_true",
        help="Opt in to one synthetic Gemini API call; tier limits may apply",
    )
    args = parser.parse_args()
    if not args.live:
        parser.error("Use --live to explicitly opt in; this command never runs in CI")
    try:
        result = GeminiGateway(Settings()).parse(
            instructions="Return an empty answer_points list for this synthetic test.",
            text="No personal, medical or insurance information is provided.",
            output_type=ModelAnswer,
        )
    except AppError as exc:
        raise SystemExit(f"Provider check unavailable: {exc.code}") from None
    except (OpenAIError, ValidationError, ValueError, TimeoutError):
        raise SystemExit(
            "Provider check unavailable; no provider details or credentials logged"
        ) from None
    print(f"Structured provider response received ({len(result.answer_points)} points).")


if __name__ == "__main__":
    main()
