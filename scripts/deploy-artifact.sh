#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <artifact.tar.gz>"
  exit 1
fi

ARTIFACT_PATH="$1"
APP_ROOT="${APP_ROOT:-/opt/ferry-services}"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%d%H%M%S)}"
RELEASE_DIR="$APP_ROOT/releases/$RELEASE_ID"

mkdir -p "$RELEASE_DIR" "$APP_ROOT/data"
tar -xzf "$ARTIFACT_PATH" -C "$RELEASE_DIR"

cd "$RELEASE_DIR"
npm ci --omit=dev
npm run migrate

ln -sfn "$RELEASE_DIR" "$APP_ROOT/current"
systemctl restart ferry-services

