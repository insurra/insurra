# INSURRA Test Results

Final run 2026-10-20 (local, macOS, Python 3.15 via uv, Node 22), after merging teammate changes.

| Command | Result |
|---|---|
| `make test` | 532 passed, 1 skipped (live Gemini test, no API key), 0 failed (an earlier run had 1 failure caused by OpenAPI snapshot drift after the merge; fixed by `make generate-types`) |
| `make check-contracts` | Passed (21 PRD operations) after `make generate-types` |
| `make check` (ruff, eslint, tsc, next build) | Passed, 0 lint errors, 6 warnings |
| `npx playwright test --project=desktop` (all specs) | 18 passed, 0 failed |
| `make test-client` | 14/14 passed (earlier run; not repeated after final edits) |

## Not run
- Playwright `mobile` project.
- Live Gemini workflow test (needs API key).
- Dedicated secret scanner.

## Reproduce
```
make setup && make migrate && make seed
make generate-types
make test && make check-contracts && make test-client && make check
lsof -ti:8177,3177 | xargs kill -9 2>/dev/null || true
cd frontend && npx playwright test --project=desktop
```
