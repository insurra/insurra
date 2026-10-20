"""Opt-in provider connectivity only; no insurance or personal documents are sent."""

import argparse
import sys
from pathlib import Path

from openai import OpenAIError
from pydantic import ValidationError

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import Settings  # noqa: E402
from app.core.errors import AppError  # noqa: E402
from app.services.ai_gateway import ResponsesGateway  # noqa: E402
from app.services.policy_qa import ModelAnswer  # noqa: E402


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
    print(f"Structured provider response received ({len(result.answer_points)} points).")


if __name__ == "__main__":
    main()
