#!/usr/bin/env bash
# Ensure Docker Tools onboarding env keys exist in deploy/.env (idempotent).
# Does NOT enable the feature — set DOCKER_TOOLS_ENABLED=1 + COMPOSE overlay on VPS.
set -euo pipefail
ENV_FILE="${1:-$(cd "$(dirname "$0")/.." && pwd)/.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ensure-docker-tools-env: missing $ENV_FILE" >&2
  exit 1
fi
upsert() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return 0
  fi
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  echo "ensure-docker-tools-env: added $key"
}
upsert DOCKER_TOOLS_ENABLED 0
upsert DOCKER_TOOLS_SOCKET '/var/run/docker.sock'
upsert DOCKER_TOOLS_SOCKET_HOST '/var/run/docker.sock'
upsert DOCKER_TOOLS_NETWORK ''
upsert DOCKER_TOOLS_REGISTRY_ALLOW ''
upsert DOCKER_TOOLS_REGISTRY_DENY ''
upsert DOCKER_TOOLS_MAX_MEMORY_MB 512
upsert DOCKER_TOOLS_MAX_CPUS 1
upsert DOCKER_TOOLS_STEPUP_TTL_MS 1800000
upsert ADMIN_PRIVILEGED_SESSION_TTL_MS 1800000
upsert DOCKER_TOOLS_RESTART_OPENCLAW 1
upsert DOCKER_GID 0
if ! grep -q 'Docker tool onboarding' "$ENV_FILE" 2>/dev/null; then
  cat >> "$ENV_FILE" <<'EOF'

# ---- Docker tool onboarding (Admin → Tools Onboarding) ----
# Enable only on hosts with docker.sock + compose overlay docker-compose.docker-tools.yml
# DOCKER_TOOLS_ENABLED=1
# DOCKER_TOOLS_REGISTRY_ALLOW=docker.io/library,docker.io/ealen
# DOCKER_TOOLS_REGISTRY_DENY=
# DOCKER_TOOLS_NETWORK=agent-os_default
# DOCKER_GID=<host docker group gid>   # e.g. getent group docker
# COMPOSE_FILE must include docker-compose.docker-tools.yml
EOF
fi