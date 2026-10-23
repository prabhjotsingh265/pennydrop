#!/bin/sh
# Restores a dump (the newest, unless one is named) into a scratch database beside the live one,
# compares the two table by table, and drops the copy. The live database is only read.
set -eu
file="${1:-$(ls -1t /backups/pennydrop-*.dump 2>/dev/null | head -n 1)}"
[ -n "$file" ] && [ -f "$file" ] || { echo "No dump to test in /backups." >&2; exit 1; }
copy=pennydrop_restore_test
sql() { PGOPTIONS='-c client_min_messages=warning' psql --quiet --no-psqlrc --tuples-only --no-align -v ON_ERROR_STOP=1 "$@"; }

echo "Restoring $(basename "$file") into $copy ..."
sql -d postgres -c "DROP DATABASE IF EXISTS $copy" -c "CREATE DATABASE $copy"
trap 'sql -d postgres -c "DROP DATABASE IF EXISTS $copy"' EXIT
pg_restore --no-owner --exit-on-error --dbname="$copy" "$file"

tables=$(sql -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")
# The copy must have every table, at the newest migration. Its rows are the day's: fewer than now.
for table in $tables; do
  live=$(sql -c "SELECT count(*) FROM \"$table\"")
  restored=$(sql -d "$copy" -c "SELECT count(*) FROM \"$table\"" 2>/dev/null) || {
    echo "Missing from the copy: $table" >&2
    exit 1
  }
  printf '%-24s %10s rows now %10s in the dump\n' "$table" "$live" "$restored"
done
newest="SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1"
[ "$(sql -c "$newest")" = "$(sql -d "$copy" -c "$newest")" ] || {
  echo "The copy is at another migration than the live database." >&2
  exit 1
}
echo "Restored, with every table, at migration $(sql -d "$copy" -c "$newest")."
