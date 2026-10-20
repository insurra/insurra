"""INSURRA Pipeline Command Line Interface.
Run via: python -m app.pipeline.cli run
Never use em dashes in strings or docstrings.
"""

import argparse
import json
import os
import sys

# Ensure SSL key logging environment variable does not cause failures
os.environ.pop("SSLKEYLOGFILE", None)

from app.pipeline.runner import PipelineRunner


def main():
    parser = argparse.ArgumentParser(description="INSURRA Insurance Intelligence Pipeline CLI")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    run_parser = subparsers.add_parser("run", help="Execute complete pipeline end-to-end")
    run_parser.add_argument(
        "--live-network",
        action="store_true",
        help="Perform live HTTP collection against permitted endpoints",
    )
    subparsers.add_parser("quality-report", help="Generate quality and provenance report only")

    args = parser.parse_args()

    if args.command == "run" or args.command is None:
        runner = PipelineRunner()
        result = runner.run(live_network=getattr(args, "live_network", False))
        print("\n" + "=" * 60)
        print("INSURRA PIPELINE EXECUTION SUCCESSFUL")
        print("=" * 60)
        print(json.dumps(result, indent=2))
        sys.exit(0)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
