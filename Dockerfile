# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base

ARG UID=1000
ARG GID=1000

ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    TURBO_TELEMETRY_DISABLED=1

# pnpm comes from Corepack, at the version pinned in package.json.
RUN corepack enable \
    && corepack prepare pnpm@10.34.7 --activate \
    && chmod -R a+rX /opt/corepack

# Run as a normal user whose ids match the host, so files written to the
# bind mount (node_modules, dist) aren't owned by root on Linux.
RUN userdel --remove node \
    && if ! getent group "${GID}" > /dev/null; then groupadd --gid "${GID}" app; fi \
    && useradd --uid "${UID}" --gid "${GID}" --create-home --shell /bin/bash app \
    && mkdir -p /pnpm-store \
    && chown "${UID}:${GID}" /pnpm-store

WORKDIR /app

FROM base AS dev

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory /app

# The package store lives on a named volume, shared by every container.
ENV npm_config_store_dir=/pnpm-store

USER app

# Chromium and the libraries it needs come from Playwright's image, matched to
# the playwright package's version. Used by the browser fetcher and its tests.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS browser

ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    TURBO_TELEMETRY_DISABLED=1 \
    npm_config_store_dir=/pnpm-store \
    HOME=/tmp

RUN corepack enable \
    && corepack prepare pnpm@10.34.7 --activate \
    && chmod -R a+rX /opt/corepack \
    && mkdir -p /pnpm-store \
    && chmod 777 /pnpm-store

WORKDIR /app

# ---- Production ----

# Everything built once: the database client, the bundles and the web app. Each
# app is then deployed with only the npm packages its bundle still imports.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm build \
    && for app in api worker fetcher shop; do \
         pnpm --filter "@pennydrop/${app}" --config.node-linker=hoisted deploy --legacy --prod "/out/${app}"; \
       done

# The API (serving the built app), the worker, the plain fetcher and the shop: one
# image, each started by its own command. A non-root user; files it keeps go in /data.
FROM node:24-bookworm-slim AS prod
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=build --chown=node:node /out /srv
COPY --from=build --chown=node:node /app/apps/web/dist /srv/web
RUN mkdir -p /data/screenshots && chown -R node:node /data
USER node

# The browser fetcher: the same fetcher, on Playwright's image with Chromium.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS browser-prod
ENV NODE_ENV=production \
    HOME=/tmp
WORKDIR /srv
COPY --from=build --chown=1000:1000 /out/fetcher /srv/fetcher
RUN mkdir -p /data/screenshots && chown -R 1000:1000 /data
USER 1000:1000
