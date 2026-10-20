# INSURRA Implementation Audit

Date: 2026-10-20. Scope: Next.js frontend, FastAPI backend, SQLAlchemy/Alembic, auth, consent, AI gateway, KB, agents.
Status legend: VERIFIED (automated test passed this session) / PARTIAL / BLOCKED / NOT VERIFIED.

## Module status

| Module | Owner area | Status | Evidence |
|---|---|---|---|
| Onboarding, account auth | Regina | VERIFIED | `account-journey.spec.ts` 1/1, backend `test_account_auth`, `test_account_workspace` |
| Documents / extraction | Regina | VERIFIED (synthetic data) | backend `test_document_intelligence`, `test_account_documents_service`; workspace E2E doc-deletion test |
| Policy Wallet | Regina | VERIFIED (backend) | `test_policy_wallet` |
| Protection Assessment / coverage-needs | Regina | VERIFIED | `test_protection_assessment`, `test_coverage_needs`; E2E SC-14 tests pass |
| Privacy / consent | Regina | VERIFIED | `test_privacy_settings`, consent revocation E2E |
| Home (SC-05) | Joshua | VERIFIED | E2E home tests pass (emergency contact, links) |
| Ask INSURRA (SC-06) | Joshua | VERIFIED | backend `test_policy_qa*` pass; all SC-06 E2E pass (cancel/retry fixed) |
| Care Pathways (SC-07) | Joshua | VERIFIED | E2E SC-07 tests pass; AU triage fails closed by design |
| Emergency | Joshua | VERIFIED (backend) | `test_emergency_guidance`, `test_safety_screen` |
| Claims Center / Claim Preparation | Joshua | VERIFIED | `claims.spec.ts` 3/3, backend claim tests |
| Renewal Agent (anti-lapse) | Joshua | VERIFIED (backend) | `test_flow_6_anti_lapse_agent` |
| Action Queue / Approval | Joshua | VERIFIED (backend) | `test_actions`, `test_actions_types` |
| Activity & Audit | Joshua | VERIFIED (backend) | `test_agent_events`, audit logger tests |

## Findings
- **F-01 (Medium, fixed)**: UI localization drift: E2E selectors still used Indonesian/older English strings. Test selectors updated; no security semantics changed.
- **F-02 (Medium, fixed)**: `/ask` did not disable input when triage unavailable or AI consent missing. Now gated by `canAsk` (policies + consent + triage). Server-side enforcement was already in place.
- **F-03 (Low, fixed)**: Home lacked accessible emergency footer / explicit quick links required by SC-05. Restored.
- **F-04 (Low, fixed)**: Care Pathways did not surface the unverified-triage banner. Wired.
- **F-05 (Low, open)**: Ask page contains hardcoded demo seed turn (`SINTA_INITIAL_TURN`) for demo persona. Narrowed so it only shows for a persona named Sinta; still hardcoded demo content.
- **F-06 (Info)**: `lib/workspace.ts` uses a microtask for setState to satisfy `react-hooks/set-state-in-effect`; an attempted rewrite was reverted.
- **F-07 (Info)**: Remaining ESLint warnings (7) are non-blocking, pre-existing.

## Files changed (this session)
- `frontend/src/lib/workspace.ts` (restored), `frontend/src/lib/api/types.gen.ts` and `backend/openapi.json` (regenerated)
- `frontend/src/app/ask/page.tsx`, `frontend/src/app/home/page.tsx`, `frontend/src/app/pathways/page.tsx`
- `frontend/tests/workspace.spec.ts`, `claims.spec.ts`, `account-journey.spec.ts`, `frontend/tests/helpers/workspace.ts`
- `frontend/playwright.config.ts` (backend webServer timeout 60s -> 120s)
- `backend/app/workflow/actions.py` (formatting only)
- `docs/audit/*` (these four reports)
