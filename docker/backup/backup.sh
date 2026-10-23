#!/bin/sh
# Pennydrop's database, dumped once a day into /backups, the last BACKUP_KEEP_DAYS (14) kept.
# Custom format: compressed, and restorable table by table. Runs in the backup service
# (compose.prod.yaml), which has PostgreSQL's own tools and PG* settings for the database.
set -u
# Only the owner reads a dump: it holds password hashes and everyone's email address.
umask 077
keep="${BACKUP_KEEP_DAYS:-14}"

backup() {
  file="/backups/pennydrop-$(date -u +%Y-%m-%d).dump"
  # Written beside and renamed once whole and readable: a dump cut short is never taken
  # for one. Then recorded, for the watchdog to notice a missed day.
  if pg_dump --format=custom --file="$file.partial" &&
    pg_restore --list "$file.partial" >/dev/null &&
    mv "$file.partial" "$file"; then
    bytes=$(wc -c <"$file" | tr -d ' ')
    psql --quiet --no-psqlrc -v ON_ERROR_STOP=1 \
      -c "INSERT INTO backups (file, bytes) VALUES ('$(basename "$file")', $bytes)" \
      -c "DELETE FROM backups WHERE taken_at < now() - interval '90 days'"
    find /backups -name 'pennydrop-*.dump' -mtime +"$keep" -delete
    echo "backup: $(basename "$file"), $bytes bytes"
  else
    rm -f "$file.partial"
    echo "backup: failed; trying again in 10 minutes" >&2
  fi
}

# Whenever the day's dump is missing, checked every 10 minutes: the first comes at once, and
# a restart never skips a day.
while true; do
  [ -f "/backups/pennydrop-$(date -u +%Y-%m-%d).dump" ] || backup
  sleep 600
done
