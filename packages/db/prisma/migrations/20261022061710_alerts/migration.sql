-- CreateEnum
CREATE TYPE "AlertRuleKind" AS ENUM ('below_target', 'drop_percent', 'any_drop', 'back_in_stock', 'lowest_ever', 'undercut');

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('email', 'slack', 'discord', 'webhook');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('active', 'broken');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'batched', 'sent', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "digest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "digest_at" INTEGER NOT NULL DEFAULT 480,
ADD COLUMN     "quiet_from" INTEGER,
ADD COLUMN     "quiet_until" INTEGER;

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" UUID NOT NULL,
    "watch_id" UUID NOT NULL,
    "kind" "AlertRuleKind" NOT NULL,
    "threshold" INTEGER,
    "armed" BOOLEAN NOT NULL DEFAULT true,
    "last_fired_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "kind" "ChannelKind" NOT NULL,
    "name" TEXT NOT NULL,
    "settings" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'active',
    "failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "watch_id" UUID NOT NULL,
    "price_point_id" UUID NOT NULL,
    "kinds" "AlertRuleKind"[],
    "price" BIGINT,
    "previous_price" BIGINT,
    "currency" CHAR(3),
    "reasons" TEXT[],
    "fired_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "send_after" TIMESTAMPTZ,
    "held_for" TEXT,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alert_rules_watch_id_kind_key" ON "alert_rules"("watch_id", "kind");

-- CreateIndex
CREATE INDEX "channels_workspace_id_idx" ON "channels"("workspace_id");

-- CreateIndex
CREATE INDEX "alerts_workspace_id_fired_at_idx" ON "alerts"("workspace_id", "fired_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "alerts_watch_id_price_point_id_key" ON "alerts"("watch_id", "price_point_id");

-- CreateIndex
CREATE INDEX "deliveries_status_send_after_idx" ON "deliveries"("status", "send_after");

-- CreateIndex
CREATE INDEX "deliveries_channel_id_created_at_idx" ON "deliveries"("channel_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_alert_id_channel_id_key" ON "deliveries"("alert_id", "channel_id");

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_watch_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_watch_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_price_point_id_fkey" FOREIGN KEY ("price_point_id") REFERENCES "price_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rules the schema can't say: a percentage that means something, and times within a day.
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_threshold_range" CHECK ("threshold" IS NULL OR "threshold" BETWEEN 1 AND 90);
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_drop_needs_threshold" CHECK ("kind" <> 'drop_percent' OR "threshold" IS NOT NULL);
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_quiet_range" CHECK (("quiet_from" IS NULL OR "quiet_from" BETWEEN 0 AND 1439) AND ("quiet_until" IS NULL OR "quiet_until" BETWEEN 0 AND 1439));
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_digest_range" CHECK ("digest_at" BETWEEN 0 AND 1439);
