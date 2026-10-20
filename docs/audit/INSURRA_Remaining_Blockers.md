# INSURRA Remaining Blockers

## Resolved this session
- SC-06 cancel/retry E2E: React reused one DOM node for the send and cancel buttons, so the cancel click did not take effect. Fixed with distinct keys and an explicit `cancelRequest()` with stale-request guards.
- Stored-XSS risk: `dangerouslySetInnerHTML` for `answer_markdown` replaced with a React-escaped renderer (`renderInline`).
- Merge regression: `lib/workspace.ts` from the merge triggered lint errors and broke ask tests; restored the `queueMicrotask` version.
- OpenAPI drift after merge: regenerated.

## Open
- Playwright mobile project not run.
- Review the `workspace.ts` restore with the teammate who merged the other version.

## Deferred by design (not implemented, not faked)
- Real insurer/provider API submission: sandbox receipts only (`RCT-*`); executors for real submission return 501.
- Blockchain anchoring: none exists, and no transaction hashes are claimed.
- Production deployment, payments, external messaging.
- Claim triage engine and verified emergency/red-flag data for AU (`UNVERIFIED`; AI pathways fail closed).
- Live Gemini end-to-end verification (needs API key).

## Phase 3 workflow verification
The ten workflows were covered by backend tests and the E2E tests listed in the Test Results report, with synthetic data. No separate scripted run of all ten end to end was performed in this session, so each should be read as test-covered, not demonstrated live.
