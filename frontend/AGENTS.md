<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Insurra frontend conventions

- Phase 1.5 is shared foundation alignment only. Preserve current Raka/Sinta demo pages and layout. PRD SC-01–SC-19 routes are specifications, not completed screens; see README and docs/prd/SCREEN_ROUTES.md. No redesign, new feature screens, ownership assignments or teammate branches.
- Domain types come from FastAPI/Pydantic through `make generate-types`; never edit types.gen.ts or handwrite duplicate Zod/domain interfaces. Use the shared typed API wrapper; api.request supports query/path parameters, JSON/multipart, PATCH/DELETE, no-content and future stream transport. Static get/post/put calls remain compatible.
- Native FormData must own its Content-Type boundary. A stream transport is not a working AI feature. Handle ApiError, network errors, cancellation, 204 and honest 501 responses; never return fake success or AI content.
- Demo tokens stay in per-tab sessionStorage and X-Demo-Session headers, never URLs/logs. Clear old persona state before switching. No privileged credentials or provider keys in browser code or NEXT_PUBLIC_*.
- Existing consent control grants process_documents only. external_ai and retention are independent, default-deny server grants, not implied by that checkbox. No client-only authorization. Seeded views remain usable without processing consent.
- Preserve accessible controls, focus/error/status states, Indonesian labels and explicit synthetic/demo badges. Display uncertainty; missing data never implies excluded coverage. No fabricated citations, prices, diagnoses or compliance decisions.
- Check `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:client`; run desktop/mobile `npm run test:e2e` for changes touching sessions or HTTP transport. Do not add dependencies or screen behavior unrelated to foundation alignment.

- Canonical PUT `/api/v1/profile` returns `{profile,suggested_docs}`; GET remains bare UserProfile. Same-country partial updates preserve omitted fields; country switches follow the context-reset rules below. Validate the resulting state before persistence. Suggestions require VERIFIED versioned country KB data; unverified placeholders return []. Claim list items carry case/checklist; draft-form uses literal `pending`; approval/rejection success contracts are status-only. Claim/action product routes remain 501. Run payload regressions as well as route/transport checks before changing contracts.

- docs/prd/SCREEN_ROUTES.md specifies existing demo→canonical PRD frontend mappings; do not point navigation at unimplemented routes or invent a claim ID. Display origin from record/document data, never the profile country. Render assessment_status=NEEDS_VERIFICATION as uncertainty even if applicable=false. A future profile editor must reload/invalidate country-derived data together after a save; current full-page session restoration is not live cross-tab synchronization. See docs/prd/COUNTRY_INTEGRATION.md; no new profile wizard is authorized here.
