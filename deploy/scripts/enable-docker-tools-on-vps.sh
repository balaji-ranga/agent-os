#!/usr/bin/env bash
# Enable Admin Tools Onboarding on a VPS that has Docker Engine + sock.
# Idempotent: upserts env + appends docker-compose.docker-tools.yml to COMPOSE_FILE.
set -euo pipefail
ENV="${1:-$(cd "$(dirname "$0")/.." && pwd)/.env}"
if [[ ! -f "$ENV" ]]; then
  echo "missing $ENV" >&2
  exit 1
fi
upsert() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV"
  fi
}
GID="$(getent group docker 2>/dev/null | cut -d: -f3 || true)"
upsert DOCKER_TOOLS_ENABLED 1
upsert DOCKER_TOOLS_SOCKET /var/run/docker.sock
upsert DOCKER_TOOLS_SOCKET_HOST /var/run/docker.sock
upsert DOCKER_TOOLS_NETWORK agent-os_default
upsert DOCKER_TOOLS_REGISTRY_ALLOW 'docker.io/library,docker.io/ealen'
upsert DOCKER_TOOLS_REGISTRY_DENY ''
upsert DOCKER_TOOLS_MAX_MEMORY_MB 512
upsert DOCKER_TOOLS_MAX_CPUS 1
upsert DOCKER_TOOLS_RESTART_OPENCLAW 1
upsert DOCKER_GID "${GID:-0}"
CF="$(grep -E '^COMPOSE_FILE=' "$ENV" | head -1 | cut -d= -f2- || true)"
if [[ -z "$CF" ]]; then
  upsert COMPOSE_FILE 'docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml:docker-compose.docker-tools.yml'
elif [[ "$CF" != *docker-compose.docker-tools.yml* ]]; then
  upsert COMPOSE_FILE "${CF}:docker-compose.docker-tools.yml"
fi
echo "DOCKER_TOOLS enabled. Review REGISTRY_ALLOW then recreate backend:"
echo "  cd deploy && docker compose up -d --force-recreate backend"
grep -E '^(DOCKER_TOOLS_|DOCKER_GID=|COMPOSE_FILE=)' "$ENV"