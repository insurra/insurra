# Shenzhen FinTechathon 2026: Source Code Submission Checklist

**Document Code:** 04_Source_Code_Submission_Checklist  
**Submission Category:** International Track  
**Project Name:** INSURRA (AI Insurance Decision and Action Companion)  
**Status:** Verification Complete and Submission Ready  

### Team Information
- **Team Name:** WGTC
- **Institution:** Universitas Indonesia
- **Team Members:**
  - Jasmine Rakhaila
  - Anggun Sasmitha
  - Regina Aruan
  - Valentino Kim
  - Joshua Hans Vito

---

## 1. Repository Identifiers and Metadata

| Item | Submission Value | Notes |
|---|---|---|
| Repository Name | INSURRA | Root repository workspace |
| GitHub Repository URL | [REPOSITORI_URL_PLACEHOLDER] | To be confirmed by maintainer before pushing |
| Active Branch | master | Main production alignment branch |
| Verified Commit SHA | 5d4ab11ff53f57fbf48e4e983691ec1a515a5829 | Local verified commit baseline |
| Deployed Web Application URL | [DEPLOYED_APP_URL_PLACEHOLDER] | Local verified at http://127.0.0.1:3000 |
| Deployed API Gateway URL | [DEPLOYED_API_URL_PLACEHOLDER] | Local verified at http://127.0.0.1:8000 |
| Documentation Path | docs/ | Architecture, deployment, testing guides |
| Submission Folder | docs/submission/ | Official competition deliverables |

---

## 2. Key Deliverable File Paths

- Primary Repository README: [README.md](../../README.md)
- Deployment Guide: [docs/DEPLOYMENT.md](../DEPLOYMENT.md)
- Testing and Verification Guide: [docs/TESTING.md](../TESTING.md)
- System Architecture Reference: [docs/ARCHITECTURE.md](../ARCHITECTURE.md)
- Technical Documentation (01): [docs/submission/01_INSURRA_Technical_Documentation.md](01_INSURRA_Technical_Documentation.md)
- Backend Environment Template: [.env.example](../../.env.example)
- Frontend Environment Template: [frontend/.env.example](../../frontend/.env.example)

---

## 3. Verification Execution Results

All commands were executed locally and verified:

### 3.1 Backend Test Suite (pytest)
- Command: `make test` (or `cd backend && uv run pytest`)
- Exit Code: 0
- Total Tests: 533 test items
- Result: 532 passed, 1 skipped (live Gemini external network call skipped in offline CI mode)
- Coverage Areas:
  - Account authentication and password hashing (PBKDF2)
  - Dual session isolation (`X-Demo-Session` vs bearer account session)
  - Three-tier purpose consent (`process_documents`, `external_ai`, `retention`)
  - Deterministic inclusive calendar interval math (Raka 76-day gap calculation)
  - Versioned country knowledge base provenance (`kb/CN`, `kb/ID`)
  - Red-flag emergency screening and safety screens
  - Cryptographic human approval gate with SHA-256 payload binding
  - Simulated insurer sandbox execution and HMAC SHA-256 audit receipts
  - Additive Alembic database schema migrations

### 3.2 Frontend Client Transport Suite (Playwright Unit)
- Command: `make test-client` (or `cd frontend && npm run test:client`)
- Exit Code: 0
- Result: 14 passed (0 failed)
- Coverage Areas:
  - Relative URL open-redirect defense
  - Server-Sent Events (SSE) UTF-8 split bytes and stream cancellation
  - Typed query serialization and HTTP 204 no-content parsing
  - FormData multipart upload without forged headers

### 3.3 Static Analysis and Build Gate
- Command: `make check`
- Backend checks:
  - `uv run ruff check . ../scripts/verify_prd_contracts.py` (Passed)
  - `uv run ruff format --check . ../scripts/verify_prd_contracts.py` (Passed, 228 files formatted)
- Frontend checks:
  - `npm run lint` (Passed, 0 errors)
  - `npm run typecheck` (Passed, TypeScript strict mode noEmit)
  - `npm run build` (Passed, Next.js 16.4.2 optimized production build created)

### 3.4 API and PRD Contract Conformance
- Command: `make check-contracts`
- Exit Code: 0
- Result:
  - `backend/openapi.json` matches generated `frontend/src/lib/api/types.gen.ts`.
  - PRD HTTP operations verified against `docs/prd/API_CONTRACT_MANIFEST.json`.

---

## 4. Source Code Hygiene Checklist

- [x] No hardcoded production passwords or secrets in tracked code.
- [x] `.env` is properly ignored by `.gitignore`.
- [x] Safe defaults provided in `.env.example`.
- [x] Purely synthetic demo data (Raka and Sinta) with zero real personal data.
- [x] No SQLite binary database files committed to git (`dev.db` ignored).
- [x] Node modules and Python virtual environments excluded from git.
- [x] No broken file links or invalid relative imports.
- [x] All 500+ automated test cases reproduce cleanly on macOS and Linux.

---

## 5. Submission Readiness Statement

The INSURRA codebase is fully verified, self-contained, and ready for evaluation. Maintainers and judges can clone the repository, run the documented setup commands, and reproduce all test results and demo workflows without external paid credentials.
