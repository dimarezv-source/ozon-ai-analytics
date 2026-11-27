#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: $0 backups/ozon-postgres-YYYYMMDDTHHMMSSZ.dump" >&2
  exit 2
fi
echo "WARNING: this replaces objects in the configured database."
read -r -p "Type RESTORE to continue: " CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || { echo "Cancelled."; exit 1; }
docker compose --env-file .env exec -T db sh -ec 'pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$1"
echo "Restore command completed. Verify application and row counts before accepting traffic."
