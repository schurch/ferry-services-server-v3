#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/home/stefan/ferry-services-server-v3}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DOCKER_IMAGE="${DOCKER_IMAGE:-stefanchurch/ferry-services:${IMAGE_TAG}}"
ENV_OLLAMA_MODEL=""

cd "$APP_ROOT"
mkdir -p data offline scripts
if [ -f .env ]; then
  ENV_OLLAMA_MODEL="$(sed -n 's/^OLLAMA_MODEL=//p' .env | tail -n 1)"
fi
OLLAMA_MODEL="${OLLAMA_MODEL:-${ENV_OLLAMA_MODEL:-qwen3:1.7b}}"

if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
fi

docker compose down --remove-orphans
docker pull "$DOCKER_IMAGE"
docker compose pull
docker compose up -d ollama
docker compose exec -T ollama ollama pull "$OLLAMA_MODEL"
docker compose run --rm --no-deps api npm run migrate
docker compose up -d --remove-orphans

docker image prune -af --filter "until=168h"
docker builder prune -af --filter "until=168h"

if [ "${PRUNE_UNUSED_VOLUMES:-0}" = "1" ]; then
  docker volume prune -f
fi

if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  docker logout
fi
