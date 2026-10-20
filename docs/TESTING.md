# INSURRA Testing Guide

This guide documents the automated test suite, security tests, test fixtures, and instructions to reproduce verification checks.

## 1. Test Suite Summary

INSURRA includes over 500 automated tests across backend services and frontend clients:
- Backend Test Suite: 532 passing tests (1 skipped for live Gemini network check in CI) implemented with pytest and FastAPI TestClient.
- Frontend Unit Test Suite: 14 passing tests in Playwright verifying HTTP transport, Server-Sent Events (SSE), URL security, and contract unwrapping.
- Contract Drift Checks: OpenAPI to TypeScript type generation and validation against PRD contract manifests.

## 2. Quick Test Commands

Run the full verification suite using these commands:

### Backend Unit and Integration Tests
```bash
make test
```
Or directly using uv:
```bash
cd backend
uv run pytest
```

### Frontend Client Transport Tests
```bash
make test-client
```
Or directly using npm:
```bash
cd frontend
npm run test:client
```

### Full Repository Quality Gate
```bash
make check
```
This runs Ruff code checks, Ruff format verification, frontend ESLint, TypeScript typecheck, and Next.js production build.

### Contract Drift Verification
```bash
make check-contracts
```
Verifies that `backend/openapi.json` matches `frontend/src/lib/api/types.gen.ts` and conforms to `docs/prd/API_CONTRACT_MANIFEST.json`.

## 3. Test Organization

The tests are located in:
- `backend/app/tests/`:
  - `test_account_auth.py`: Account registration, PBKDF2 hashing, Google OAuth session generation.
  - `test_session_isolation.py`: Dual-session boundary (`X-Demo-Session` vs account session) and cross-tenant scoping.
  - `test_privacy_settings.py`: Three-tier consent checks (`process_documents`, `external_ai`, `retention`) and revocation behavior.
  - `test_rules_and_guards.py`: Deterministic rule evaluation, missing evidence handling, and safe error envelopes.
  - `test_actions.py` & `test_claims_intelligence_and_agentic_actions.py`: Cryptographic approval hashing, duplicate action prevention, and sandbox state transitions.
  - `test_intervals.py`: Inclusive calendar interval math (e.g. Raka's 76-day gap calculation).
  - `test_migrations.py`: Additive Alembic schema migration regressions and legacy data preservation.
  - `test_safety_screen.py`: Red-flag medical symptom screening and emergency triage availability.
- `frontend/tests/`:
  - `client.spec.ts`: Native fetch wrapper, query parameter encoding, and 204 response handling.
  - `safe-redirect.spec.ts`: Open-redirect defense for authentication flows.
  - `ask-stream.spec.ts`: Server-Sent Events stream chunking and UTF-8 handling.
  - `workspace.spec.ts`: End-to-end workspace navigation and action flows.

## 4. How to Test Critical Security and Workflow Scenarios

### 4.1 Missing Evidence
To verify that missing or incomplete policy data is never treated as covered or excluded:
```bash
cd backend
uv run pytest app/tests/test_rules_and_guards.py -k "missing_evidence"
```
Behavior: When required policy facts or emergency guidelines are unverified, the system returns `NEEDS_VERIFICATION` or `TRIAGE_UNAVAILABLE`. It never invents insurance coverage.

### 4.2 Unauthorized Cross-Tenant Access
To verify that actors cannot access another user's documents or action cases:
```bash
cd backend
uv run pytest app/tests/test_session_isolation.py -k "isolation"
```
Behavior: Attempting to access an object owned by another session returns `404 NOT_FOUND` rather than `403 FORBIDDEN` to prevent resource enumeration.

### 4.3 Consent Revocation
To verify that revoking AI consent immediately blocks external AI calls:
```bash
cd backend
uv run pytest app/tests/test_privacy_settings.py -k "consent"
```
Behavior: Once `external_ai` is set to false, all protected AI calls fail closed and return an appropriate consent error.

### 4.4 Approval Payload Modification (Tampering Defense)
To verify that modifying an action payload invalidates human approval:
```bash
cd backend
uv run pytest app/tests/test_claims_intelligence_and_agentic_actions.py -k "approval"
```
Behavior: Approvals must provide the exact `expected_payload_hash` matching the SHA-256 digest of the server action payload. If the payload is modified, approval is rejected with `409 CONFLICT`.

### 4.5 Duplicate Execution Prevention
To verify idempotency of approved actions:
```bash
cd backend
uv run pytest app/tests/test_actions.py -k "duplicate"
```
Behavior: An action can only transition from `AWAITING_APPROVAL` to `APPROVED` once. Resubmitting or triggering execution again returns `409 ACTION_ALREADY_EXECUTED`.

### 4.6 Sandbox Execution and Receipt Verification
To test simulated insurer execution and verify HMAC SHA-256 receipts:
```bash
cd backend
uv run pytest app/tests/test_claims_intelligence_and_agentic_actions.py -k "sandbox"
```
Behavior: After execution completes, the database records an audit event with an HMAC SHA-256 cryptographic signature, timestamp, and actor ID.

## 5. Test Fixtures

Test fixtures reside in:
- `fixtures/raka/`: Synthetic profile for Raka, an Indonesian student in Melbourne. Contains sample overseas student health cover metadata.
- `fixtures/sinta/`: Synthetic profile for Sinta, a domestic worker in Jakarta. Contains sample BPJS and employer benefits metadata.
- `backend/app/tests/workspace_fixtures.py`: Pre-seeded in-memory SQLite fixtures for isolated integration tests.
