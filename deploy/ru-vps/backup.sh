#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
mkdir -p backups
chmod 700 backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="backups/ozon-postgres-$STAMP.dump"
umask 077
docker compose --env-file .env exec -T db sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT"
test -s "$OUT"
docker compose --env-file .env exec -T db sh -ec 'pg_restore --list' < "$OUT" >/dev/null
find backups -maxdepth 1 -type f -name 'ozon-postgres-*.dump' -mtime +14 -delete
echo "Backup created and archive header verified: $OUT"
