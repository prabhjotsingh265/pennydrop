-- CreateEnum
CREATE TYPE "SitePolicy" AS ENUM ('allowed', 'api_only', 'blocked');

-- CreateEnum
CREATE TYPE "RobotsStatus" AS ENUM ('ok', 'missing', 'unreachable');

-- CreateEnum
CREATE TYPE "BreakerState" AS ENUM ('closed', 'open', 'half_open');

-- CreateEnum
CREATE TYPE "TargetStatus" AS ENUM ('active', 'needs_attention', 'blocked', 'gone', 'paused');

-- CreateEnum
CREATE TYPE "FetchMode" AS ENUM ('http', 'browser');

-- CreateEnum
CREATE TYPE "CheckReason" AS ENUM ('scheduled', 'manual', 'preview', 'confirm', 'replay');

-- CreateEnum
CREATE TYPE "CheckOutcome" AS ENUM ('ok', 'unchanged', 'suspicious', 'price_not_found', 'blocked', 'rate_limited', 'http_error', 'gone', 'robots_disallowed', 'timeout', 'network_error', 'too_large', 'not_html', 'blocked_address', 'skipped_breaker_open');

-- CreateEnum
CREATE TYPE "RecipeSource" AS ENUM ('user', 'auto', 'healed');

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('layout_changed', 'selector_healed', 'needs_browser', 'breaker_opened', 'breaker_closed', 'blocked', 'robots_disallowed', 'suspicious_price', 'out_of_stock', 'back_in_stock', 'gone');

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "host" TEXT NOT NULL,
    "registrable" TEXT NOT NULL,
    "policy" "SitePolicy" NOT NULL DEFAULT 'allowed',
    "demo_allowed" BOOLEAN NOT NULL DEFAULT false,
    "robots_txt" TEXT,
    "robots_status" "RobotsStatus",
    "robots_fetched_at" TIMESTAMPTZ,
    "crawl_delay" INTEGER,
    "min_gap_ms" INTEGER NOT NULL DEFAULT 10000,
    "max_in_flight" INTEGER NOT NULL DEFAULT 1,
    "needs_browser" BOOLEAN NOT NULL DEFAULT false,
    "breaker_state" "BreakerState" NOT NULL DEFAULT 'closed',
    "breaker_open_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "selector" TEXT NOT NULL,
    "attribute" TEXT,
    "pattern" TEXT,
    "source" "RecipeSource" NOT NULL,
    "active_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "misses" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "targets" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "canonical_url" TEXT NOT NULL,
    "status" "TargetStatus" NOT NULL DEFAULT 'active',
    "interval_seconds" INTEGER NOT NULL DEFAULT 21600,
    "next_check_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_checked_at" TIMESTAMPTZ,
    "last_success_at" TIMESTAMPTZ,
    "failure_streak" INTEGER NOT NULL DEFAULT 0,
    "etag" TEXT,
    "last_modified" TEXT,
    "title" TEXT,
    "current_price" BIGINT,
    "currency" CHAR(3),
    "in_stock" BOOLEAN,
    "pending_price" BIGINT,
    "pending_since" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checks" (
    "id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "job_id" TEXT NOT NULL,
    "reason" "CheckReason" NOT NULL,
    "mode" "FetchMode",
    "scheduled_for" TIMESTAMPTZ NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "finished_at" TIMESTAMPTZ NOT NULL,
    "outcome" "CheckOutcome" NOT NULL,
    "http_status" INTEGER,
    "timings" JSONB,
    "strategy" TEXT,
    "confidence" DOUBLE PRECISION,
    "price" BIGINT,
    "was_price" BIGINT,
    "currency" CHAR(3),
    "in_stock" BOOLEAN,
    "detail" TEXT,
    "readings" JSONB,

    CONSTRAINT "checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_points" (
    "id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "first_seen_at" TIMESTAMPTZ NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "price" BIGINT,
    "was_price" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "in_stock" BOOLEAN NOT NULL,
    "first_check_id" UUID NOT NULL,
    "replayed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "price_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "site_id" UUID,
    "target_id" UUID,
    "kind" "EventKind" NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sites_host_key" ON "sites"("host");

-- CreateIndex
CREATE INDEX "recipes_site_id_retired_at_idx" ON "recipes"("site_id", "retired_at");

-- CreateIndex
CREATE UNIQUE INDEX "targets_canonical_url_key" ON "targets"("canonical_url");

-- CreateIndex
CREATE INDEX "targets_status_next_check_at_idx" ON "targets"("status", "next_check_at");

-- CreateIndex
CREATE INDEX "targets_site_id_idx" ON "targets"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "checks_job_id_key" ON "checks"("job_id");

-- CreateIndex
CREATE INDEX "checks_target_id_started_at_idx" ON "checks"("target_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "checks_started_at_idx" ON "checks"("started_at");

-- CreateIndex
CREATE INDEX "price_points_target_id_first_seen_at_idx" ON "price_points"("target_id", "first_seen_at" DESC);

-- CreateIndex
CREATE INDEX "events_target_id_at_idx" ON "events"("target_id", "at");

-- CreateIndex
CREATE INDEX "events_site_id_at_idx" ON "events"("site_id", "at");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checks" ADD CONSTRAINT "checks_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rules the schema language can't express; Prisma keeps them in later migrations.
ALTER TABLE "targets" ADD CONSTRAINT "targets_interval_sane" CHECK ("interval_seconds" >= 60);
ALTER TABLE "targets" ADD CONSTRAINT "targets_price_positive" CHECK ("current_price" IS NULL OR "current_price" > 0);
ALTER TABLE "targets" ADD CONSTRAINT "targets_currency_code" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_price_positive" CHECK ("price" IS NULL OR "price" > 0);
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_seen_in_order" CHECK ("last_seen_at" >= "first_seen_at");
ALTER TABLE "checks" ADD CONSTRAINT "checks_finished_after_start" CHECK ("finished_at" >= "started_at");
