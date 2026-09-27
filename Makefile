COMPOSE = docker compose -f infra/docker-compose.yml --env-file infra/.env

.PHONY: up down logs seed dev-seed mongo-ui test gen-api dev-desktop dev-desktop-live demo-check migrate

up:            ## start all services
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=100

migrate:       ## apply DB migrations
	$(COMPOSE) exec api alembic upgrade head

# dev-seed first: ingestion then matches the golden patients to its fixed ids (the desktop's ids).
seed: dev-seed  ## rebuild database and mock EHRs (spec section 16) - Alessandra
	$(COMPOSE) exec api python -m app.ingest.seed

dev-seed: migrate  ## demo users + patients + care teams (stopgap until `seed`), copied to Mongo - Brandon
	$(COMPOSE) exec api python -m app.dev_seed

mongo-ui:       ## browse the LiveScribing MongoDB at http://localhost:8082 (localhost only) - Brandon
	$(COMPOSE) --profile tools up -d mongo-express

test:
	pytest services/api/tests -q
	cd services/resident && pytest tests -q

gen-api:       ## regenerate TS types from gateway OpenAPI - Daniel
	cd apps/desktop && pnpm gen:api

dev-desktop:
	cd apps/desktop && pnpm dev

# Routes the gateway serves for real go live; everything else stays on the desktop's mocks. Needs `make up seed`.
LIVE_ROUTES = /auth/login,/auth/refresh,/me,/patients,/patients/*,/patients/*/summary,$\
/patients/*/transcripts,/transcripts/*/consent,/admin/consent-tasks,$\
/patients/*/live-scribe-sessions,/patients/*/live-scribe-sessions/*,/patients/*/live-scribe-sessions/*/window,$\
/patients/*/live-scribe-sessions/*/stop,/patients/*/live-scribe-sessions/*/report,/patients/*/live-scribe-sessions/*/review
dev-desktop-live:  ## desktop against the running stack (mixed mode)
	cd apps/desktop && VITE_USE_MOCKS=true VITE_LIVE_ROUTES='$(LIVE_ROUTES)' pnpm dev

demo-check:    ## golden checks from spec section 18.5 - Ron
	$(COMPOSE) exec api python -m app.demo_check
