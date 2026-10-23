-- CreateTable
CREATE TABLE "backups" (
    "id" BIGSERIAL NOT NULL,
    "taken_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);
