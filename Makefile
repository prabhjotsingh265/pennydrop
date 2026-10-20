# Everything runs inside Docker. These are shortcuts for the commands used most.

HOST_UID := $(shell id -u)
HOST_GID := $(shell id -g)
export HOST_UID HOST_GID

COMPOSE := docker compose
TOOLS := $(COMPOSE) run --rm --no-deps tools

.DEFAULT_GOAL := help

.PHONY: help setup up down restart build logs shell pnpm install check test lint format

help: ## List the available commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-10s %s\n", $$1, $$2}'

setup: ## First run on a new machine: build, install, start
	@test -f .env || cp .env.example .env
	$(COMPOSE) build
	$(TOOLS) pnpm install
	$(COMPOSE) up -d
	@echo ""
	@echo "Pennydrop is running at http://localhost:$${FORWARD_WEB_PORT:-3000}"
	@echo "Emails are caught at    http://localhost:$${FORWARD_MAILPIT_DASHBOARD_PORT:-8026}"

up: ## Start every container
	$(COMPOSE) up -d

down: ## Stop every container
	$(COMPOSE) down

restart: down up ## Stop, then start again

build: ## Rebuild the Node image
	$(COMPOSE) build

logs: ## Follow the logs of every container
	$(COMPOSE) logs -f

shell: ## Open a shell in a fresh tools container
	$(TOOLS) bash

pnpm: ## Run a pnpm command, e.g. make pnpm c="add zod --filter @pennydrop/api"
	$(TOOLS) pnpm $(c)

install: ## Install packages after package.json changes
	$(TOOLS) pnpm install

check: ## Formatting, lint, type checks and tests: what CI runs
	$(TOOLS) pnpm check

test: ## Run every test suite
	$(TOOLS) pnpm test

lint: ## Lint every package
	$(TOOLS) pnpm lint

format: ## Format every file with Prettier
	$(TOOLS) pnpm format
