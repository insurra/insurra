# Phase 1.5 foundation stabilization verification

Verified locally on 17 October 2026 using committed uv/npm lockfiles. No dependency versions or migration history were changed. No paid API, hosted CI, deployment or production authentication was exercised.

| Command / check | Result |
| --- | --- |
| `npm_config_cache=/private/tmp/insurra-npm-cache make setup` | PASS: locked uv sync and npm ci |
| `cd backend && UV_CACHE_DIR=../.cache/uv ../.tools/bin/uv run ruff format ../scripts/verify_prd_contracts.py app/tests/test_prd_contract_manifest.py` | PASS; formatting completed |
| `make migrate` / `make seed` | PASS: existing local database at 0003; seed inserted 0 |
| Fresh temporary SQLite: `DATABASE_URL=sqlite:///<temporary-directory>/foundation.db make migrate`, then `make seed` twice with the same URL | PASS: 0001 → 0002 → 0003; seed inserted 2 then 0; original database untouched |
| `make test` | PASS: 128 tests, 0 failures/skips; one upstream Starlette/httpx deprecation warning |
| `make check` | PASS: Ruff check/format (70 files), ESLint, strict TypeScript, production build |
| `make generate-types` then `make check-contracts` | PASS: generated OpenAPI/TypeScript match Python and all 21 manifest operations are registered |
| `make check-prd-source` | PASS: all 21 operations match the local API CSV, including query/multipart and 501 boundaries |
| `make test-client` | PASS: 7 tests; generated profile envelope, legacy GET, multipart/query, PATCH/DELETE, 204, streaming/errors/cancellation |
| `cd frontend && CI=1 PLAYWRIGHT_BROWSERS_PATH=/private/tmp/insurra-browsers npm run test:e2e` | PASS: 2 tests, desktop and mobile; fresh production frontend/backend |
| `actionlint 1.7.7 .github/workflows/foundation-ci.yml` | PASS: official release archive checksum verified; no lint diagnostics |
| `npm audit --omit=dev --json` | PASS: 0 production findings; locked install reports 5 high development lint-chain findings |
| Source/history audit | PASS: five original CSV SHA-256 values unchanged; no CSV staged/tracked; frontend framework AGENTS block unchanged; original commits, lockfiles and migrations retained |

Backend tests cover fresh migrated SQLite fixtures, populated 0001 upgrade snapshots, independent purpose consent/revocation, IDOR and foreign-key guards, approval hash binding, no false deletion success, seed idempotency, AU 76-day/ID non-applicability calculations, KB metadata, payload validation and contract drift. PostgreSQL DDL is compiled, but no live PostgreSQL migration is claimed.

One final development-server browser rerun stalled on the onboarding RSC request while all backend session/profile/data requests returned 2xx. CI now runs `npm run build && npm run start` before the unchanged browser assertions; production desktop/mobile flows passed. Test timeouts/assertions were not weakened and no tests were removed or skipped. Local non-CI Playwright runs retain the existing development-server option.

The 21-operation route checker is deliberately limited to transport/registration. The separate field-by-field audit and intentional normalizations are in [API_CONTRACTS.md](prd/API_CONTRACTS.md). Canonical profile PUT now returns `{profile,suggested_docs}`; external PUT callers must read `.profile`. GET/demo behavior is preserved. Claim-list checklist envelopes, draft `pending` and status-only action decisions change future success schemas; their endpoints remain 501. Uppercase legacy domain enums, lower-case consent purposes, decimal-string estimates, list pagination and explicit SSE framing are documented technical normalizations.

Existing migrations remain 0001 (original), 0002 (consent/scoped identities and online backfill), 0003 (approval payload JSON). This stabilization needs no new migration. No uploaded originals are stored; country recommendations remain empty/unverified. Real auth, OCR/AI, medical/claim workflows, action execution, privacy cleanup, P1/bonus features and the full screen set remain deferred within the authorized scope. Hosted CI, live PostgreSQL and real integrations remain unverified. Review the development-only dependency findings before publishing.

**GO for maintainer review of the shared foundation.** No team ownership has been assigned. Foundation is ready for a separate feature split only after maintainer review.
