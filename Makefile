# Everything runs inside Docker. These are shortcuts for the commands used most.

HOST_UID := $(shell id -u)
HOST_GID := $(shell id -g)
export HOST_UID HOST_GID

COMPOSE := docker compose
TOOLS := $(COMPOSE) run --rm --no-deps tools

.DEFAULT_GOAL := help

.PHONY: help setup up down restart build logs shell pnpm install migrate seed replay demo check test test-browser e2e lint format prod-build prod-up prod-down prod-logs prod-migrate prod-demo prod-e2e prod-backup prod-backup-test prod-backup-latest prod-restore

help: ## List the available commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-10s %s\n", $$1, $$2}'

setup: ## First run on a new machine: build, install, start
	@test -f .env || cp .env.example .env
	$(COMPOSE) build
	$(TOOLS) pnpm install
	$(COMPOSE) up -d postgres redis
	$(TOOLS) pnpm --filter @pennydrop/db generate
	$(TOOLS) pnpm --filter @pennydrop/db migrate
	$(COMPOSE) up -d
	@echo ""
	@echo "Pennydrop is running at http://localhost:$${FORWARD_WEB_PORT:-3000}"
	@echo "Emails are caught at    http://localhost:$${FORWARD_MAILPIT_DASHBOARD_PORT:-8026}"

up: ## Start every container
	$(COMPOSE) up -d

down: ## Stop every container
	$(COMPOSE) down

restart: down up ## Stop, then start again

build: ## Rebuild the Node and Chromium images
	$(COMPOSE) build
	$(COMPOSE) --profile browser build browser

logs: ## Follow the logs of every container
	$(COMPOSE) logs -f

shell: ## Open a shell in a fresh tools container
	$(TOOLS) bash

pnpm: ## Run a pnpm command, e.g. make pnpm c="add zod --filter @pennydrop/api"
	$(TOOLS) pnpm $(c)

install: ## Install packages after package.json changes
	$(TOOLS) pnpm install

migrate: ## Apply database migrations
	$(TOOLS) pnpm --filter @pennydrop/db migrate

seed: ## Add the practice shops and their products, to watch the pipeline work
	$(TOOLS) pnpm --filter @pennydrop/worker seed

demo: ## Build the demo's showcase: its products, always checked, with replayed history (days=60, wait=1)
	$(TOOLS) pnpm --filter @pennydrop/worker demo --days $(or $(days),60) $(if $(wait),--wait)

replay: ## Replay the history of watched practice-shop products (days=60 to choose how far back)
	$(TOOLS) pnpm --filter @pennydrop/worker replay --days $(or $(days),60)

check: ## Formatting, lint, type checks and tests: what CI runs
	$(TOOLS) pnpm check

test: ## Run every test suite
	$(TOOLS) pnpm test

test-browser: ## Run the tests that need a real Chromium
	$(COMPOSE) run --rm --no-deps browser pnpm --filter @pennydrop/fetcher test:browser

# On the web container's own network, so the page's origin is http://localhost:3000, the one the
# API trusts. Every local visitor shares one address, so the demo's count for it is cleared first.
e2e: ## Run the end-to-end tests against the running app (make up first)
	$(COMPOSE) exec -T redis sh -c 'redis-cli --scan --pattern "pennydrop:limit:POST:/api/demo:*" | while IFS= read -r k; do redis-cli del "$$k" >/dev/null; done'
	docker run --rm --network container:$$($(COMPOSE) ps -q web) --user $$(id -u):$$(id -g) \
		-v "$(CURDIR)":/app -v pennydrop_pnpm-store:/pnpm-store -w /app -e HOME=/tmp \
		pennydrop-browser:dev pnpm --filter @pennydrop/e2e e2e

lint: ## Lint every package
	$(TOOLS) pnpm lint

format: ## Format every file with Prettier
	$(TOOLS) pnpm format

# ---- Production: the built apps, from compose.prod.yaml and .env.production ----
# env=… to use another settings file, such as a local rehearsal's.
PROD_ENV := $(or $(env),.env.production)
PROD := ENV_FILE=$(PROD_ENV) $(COMPOSE) --env-file $(PROD_ENV) -f compose.prod.yaml

prod-build: ## Production: build the images (the tools' too)
	$(PROD) --profile tools build

prod-up: prod-build ## Production: build, start the data, apply migrations, start everything
	$(PROD) up -d --wait postgres redis
	$(PROD) run --rm tools pnpm --filter @pennydrop/db migrate
	$(PROD) up -d --wait

prod-down: ## Production: stop everything (data is kept)
	$(PROD) down

prod-logs: ## Production: follow the logs
	$(PROD) logs -f --tail 100

prod-migrate: ## Production: apply database migrations
	$(PROD) run --rm tools pnpm --filter @pennydrop/db migrate

prod-demo: ## Production: build the demo's showcase (days=60)
	$(PROD) run --rm tools pnpm --filter @pennydrop/worker demo --days $(or $(days),60) --wait

prod-backup: ## Production: list the database backups (one a day, the last 14 kept)
	$(PROD) exec -T backup ls -lh /backups

prod-backup-test: ## Production: restore a backup into a scratch database and compare it (file=newest)
	$(PROD) exec -T backup /scripts/restore-test.sh $(if $(file),/backups/$(notdir $(file)))

prod-backup-latest: ## Production: the newest backup, to stdout: ssh server 'make -s -C pennydrop prod-backup-latest' > x.dump
	@$(PROD) exec -T backup sh -c 'cat "$$(ls -1t /backups/pennydrop-*.dump | head -n 1)"'

prod-restore: ## Production: replace the database with a backup (file=pennydrop-YYYY-MM-DD.dump confirm=yes)
	@[ "$(confirm)" = yes ] || { echo "This replaces the live database. Add confirm=yes to go ahead."; exit 1; }
	@[ -n "$(file)" ] || { echo "Name the backup: file=pennydrop-YYYY-MM-DD.dump (make prod-backup lists them)"; exit 1; }
	$(PROD) stop api worker fetch-http fetch-browser
	$(PROD) exec -T backup /scripts/restore.sh /backups/$(notdir $(file))
	$(PROD) run --rm tools pnpm --filter @pennydrop/db migrate
	$(PROD) up -d --wait

prod-e2e: ## Production: run the end-to-end tests against its APP_URL, from the API's own network
	$(PROD) exec -T redis sh -c 'redis-cli --scan --pattern "pennydrop:limit:POST:/api/demo:*" | while IFS= read -r k; do redis-cli del "$$k" >/dev/null; done'
	docker run --rm --network container:$$($(PROD) ps -q api) --user $$(id -u):$$(id -g) \
		-v "$(CURDIR)":/app -v pennydrop_pnpm-store:/pnpm-store -w /app -e HOME=/tmp \
		-e E2E_BASE_URL=$$(sed -n 's/^APP_URL=//p' $(PROD_ENV)) pennydrop-browser:dev pnpm --filter @pennydrop/e2e e2e
