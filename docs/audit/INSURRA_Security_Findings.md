# INSURRA Security Findings

Basis: existing backend regression suite (532 passed, 1 skipped) plus E2E checks run in this session. No new Critical/High vulnerability was reproduced. "Verified" means covered by an automated test that passed; it is not a formal penetration test.

| Control | Result | Evidence |
|---|---|---|
| Cross-user access (missing and foreign objects return 404) | Verified | `test_session_isolation`, `test_account_workspace` |
| Demo vs account session isolation; ambiguous headers rejected (422 `AMBIGUOUS_ACTOR`) | Verified | `test_session_isolation`, `test_account_auth` |
| Server-side consent per purpose (`process_documents`, `external_ai`, `retention`), rechecked each call | Verified | `test_privacy_settings`, E2E revoked-consent test |
| LLM tool authorization / prompt injection | Verified (offline/mock gateway) | `test_agent_tools`, `test_ai_gateway`, `test_policy_guard` |
| Document storage / extraction access | Verified | `test_account_documents_service`, deletion E2E |
| Approval bound to exact payload hash; tampering, expiry, duplicate execution rejected | Verified | `test_actions`, `test_payload_contracts` |
| Sandbox-only execution; receipts HMAC-signed (`RCT-*`) | Verified | `test_actions_types`; no real insurer call exists |
| Credentials / unsafe logging | Not exhaustively scanned | No secrets in changed files; no dedicated secret scanner was run |

## Open items
- **S-01 (Medium, FIXED)**: previously `dangerouslySetInnerHTML` in `ask/page.tsx` renders `answer_markdown` after only a bold-tag regex. If model output is not escaped server-side, this is an XSS risk. Not exploited or tested this session. Replaced with a React-escaped renderer; E2E and typecheck pass.
- **S-02 (Info)**: The live Gemini test was skipped (no key), so real-LLM prompt-injection behavior is unverified.
- **S-03 (Info)**: Demo-mode auto-grant of consent on `send()` exists for demo sessions only; account sessions require explicit consent.
