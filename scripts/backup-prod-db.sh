#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/home/stefanchurch/ferry-services-server-v3}"
cd "$APP_ROOT"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required on the host to create a backup" >&2
  exit 1
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

DATABASE_PATH="${DATABASE_PATH:-./data/ferry-services.sqlite3}"
BACKUP_DIR="${BACKUP_DIR:-$APP_ROOT/data/backups}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
BACKUP_PATH="${1:-$BACKUP_DIR/ferry-services-$TIMESTAMP.sqlite3}"

case "$DATABASE_PATH" in
  /*) LIVE_DB_PATH="$DATABASE_PATH" ;;
  *) LIVE_DB_PATH="$APP_ROOT/${DATABASE_PATH#./}" ;;
esac

mkdir -p "$(dirname "$BACKUP_PATH")"

if [ ! -f "$LIVE_DB_PATH" ]; then
  echo "Live database not found: $LIVE_DB_PATH" >&2
  exit 1
fi

sqlite3 "$LIVE_DB_PATH" ".backup '$BACKUP_PATH'"

echo "Database backup created at $BACKUP_PATH"
