#!/bin/sh
# Replaces the live database with a dump. Run only with the apps stopped (make prod-restore).
set -eu
file="$1"
[ -f "$file" ] || { echo "No such dump: $file" >&2; exit 1; }
echo "Restoring $(basename "$file") over the live database ..."
pg_restore --clean --if-exists --no-owner --exit-on-error --single-transaction \
  --dbname="$PGDATABASE" "$file"
echo "Restored."
