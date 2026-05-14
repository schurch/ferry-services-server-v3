#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <artifact.tar.gz>"
  exit 1
fi

ARTIFACT_PATH="$1"
APP_ROOT="${APP_ROOT:-/home/stefanchurch/ferry-services-server-v3}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=()
else
  SUDO=(sudo -n)
fi

mkdir -p "$APP_ROOT" "$APP_ROOT/data"
tar -xzf "$ARTIFACT_PATH" -C "$APP_ROOT"

cd "$APP_ROOT"
npm run migrate

"${SUDO[@]}" systemctl restart ferry-services
