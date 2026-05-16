#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/home/stefanchurch/ferry-services-server-v3}"

if [ $# -ne 1 ]; then
  echo "Usage: $0 /absolute/or/relative/path/to/backup.sqlite3" >&2
  exit 1
fi

BACKUP_SOURCE="$1"

cd "$APP_ROOT"

if [ ! -f "$BACKUP_SOURCE" ]; then
  echo "Backup file not found: $BACKUP_SOURCE" >&2
  exit 1
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

DATABASE_PATH="${DATABASE_PATH:-./data/ferry-services.sqlite3}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
case "$DATABASE_PATH" in
  /*) LIVE_DB_PATH="$DATABASE_PATH" ;;
  *) LIVE_DB_PATH="$APP_ROOT/${DATABASE_PATH#./}" ;;
esac
PRE_RESTORE_BACKUP="${LIVE_DB_PATH%.sqlite3}.pre-restore-$TIMESTAMP.sqlite3"

mkdir -p "$(dirname "$LIVE_DB_PATH")"

docker compose down --remove-orphans

if [ -f "$LIVE_DB_PATH" ]; then
  cp -a "$LIVE_DB_PATH" "$PRE_RESTORE_BACKUP"
fi

cp -a "$BACKUP_SOURCE" "$LIVE_DB_PATH"
rm -f "${LIVE_DB_PATH}-wal" "${LIVE_DB_PATH}-shm"

docker compose up -d --remove-orphans

echo "Database restored from $BACKUP_SOURCE"
if [ -f "$PRE_RESTORE_BACKUP" ]; then
  echo "Previous live database saved to $PRE_RESTORE_BACKUP"
fi
