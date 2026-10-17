UV := $(shell command -v uv 2>/dev/null || echo $(CURDIR)/.tools/bin/uv)
export UV_CACHE_DIR := $(CURDIR)/.cache/uv
.PHONY: setup dev-backend dev-frontend migrate seed test generate-types check
setup:
	@test -x "$(UV)" || (python3 -m venv .tools && .tools/bin/pip install uv)
	cd backend && $(UV) sync --locked
	cd frontend && npm ci
migrate:
	cd backend && $(UV) run alembic upgrade head
seed:
	cd backend && $(UV) run python -m app.seeds.demo
dev-backend:
	cd backend && $(UV) run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
dev-frontend:
	cd frontend && npm run dev
test:
	cd backend && $(UV) run pytest
check:
	cd backend && $(UV) run ruff check . && $(UV) run ruff format --check .
	cd frontend && npm run lint && npm run typecheck && npm run build
generate-types:
	cd backend && $(UV) run python ../scripts/export_openapi.py
	cd frontend && npm run generate-types

.PHONY: check-contracts test-client
check-contracts:
	cd backend && $(UV) run python ../scripts/check_contracts.py
test-client:
	cd frontend && npm run test:client
