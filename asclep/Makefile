COMPOSE = docker compose -f infra/docker-compose.yml --env-file infra/.env

.PHONY: up down logs seed test gen-api dev-desktop demo-check migrate

up:            ## start all services
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=100

migrate:       ## apply DB migrations
	$(COMPOSE) exec api alembic upgrade head

seed: migrate  ## rebuild database and mock EHRs (spec section 16) - Alessandra
	$(COMPOSE) exec api python -m app.ingest.seed

test:
	pytest services/api/tests -q

gen-api:       ## regenerate TS types from gateway OpenAPI - Daniel
	cd apps/desktop && pnpm gen:api

dev-desktop:
	cd apps/desktop && pnpm dev

demo-check:    ## golden checks from spec section 18.5 - Ron
	$(COMPOSE) exec api python -m app.demo_check
