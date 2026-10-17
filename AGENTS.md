# Working in AI Insurance Companion

- Phase 1 is foundation only. Keep extraction, retrieval/chat, care, claim drafting and action execution behind honest HTTP 501 skeletons until explicitly assigned Phase 2 work.
- Backend owns Pydantic schemas, persistence, consent, session boundaries, deterministic rules, and all provider credentials. Frontend owns Indonesian presentation and accessible interactions.
- Python schemas and FastAPI OpenAPI are the domain source of truth. Run `make generate-types` after contract changes and commit `backend/openapi.json` and `frontend/src/lib/api/types.gen.ts`. Never hand-edit generated types or duplicate domain models in TypeScript.
- Keep schemas small, use stable English snake_case fields/enums, forbid extra fields, validate dates, and represent money as decimal strings. Use timezone-aware UTC timestamps.
- Use SQLAlchemy 2 session-scoped repositories and Alembic migrations. Do not call `create_all` in application startup. Synthetic template seeding must be idempotent.
- Country-specific rules, terminology, categories and pathways live in versioned `kb/{ISO_CODE}` resources. Add countries through configuration, without country branches in services.
- Numerical assessments use Python dates/decimal arithmetic, never LLM arithmetic. Date intervals include both endpoints. Unknown information never implies absent coverage.
- Never invent policy quotations, page numbers, benefits, medical costs, regulatory citations or legal certainty. Unchecked sources stay UNVERIFIED with null checked_at/source_url.
- Enforce `X-Demo-Session` ownership and current database consent on protected routes. Never log tokens. Keep audit metadata on the operational allow-list. Approval must be persisted server-side before any future execution.
- No real PII, provider integrations, claim submissions, or autonomous agent orchestration in Phase 1. No live AI calls in tests or foundation routes.
- Never hardcode credentials or put privileged configuration in `NEXT_PUBLIC_*`. Do not track `.env`, databases, runtime artifacts, or sensitive files.
- Python: Ruff format/check, 100-column target, Python 3.11+. TypeScript: strict mode, native fetch through the typed API wrapper, React state/context, ESLint. Reuse shadcn/ui Button and Lucide icons.
- Before commits run checks relevant to the change: `make test`, `make check`; run desktop/mobile `npm run test:e2e` for changes affecting the demo flow. Regenerate contracts when needed and inspect the staged diff for secrets.
- Use Conventional Commits grouped by logical change. Preserve user edits and Git history; never auto-push, reset, amend, rebase, or deploy.
