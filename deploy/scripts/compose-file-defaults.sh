#!/usr/bin/env bash
# Canonical Compose file list for Agent OS on production VPS.
#
# Source from deploy/scripts (do not exec unless testing). Any recreate of backend/nginx
# without docker-compose.vps-client-ip.yml historically left nginx in host networking
# while backend lost 127.0.0.1:3001 publish → public /api (including login) 502.
#
# Order matters (later files override):
#   base → browser → vps-client-ip (host nginx + loopback upstreams) → docker-tools
#
# shellcheck disable=SC2034
VPS_COMPOSE_FILE_DEFAULT='docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml:docker-compose.docker-tools.yml:docker-compose.content-antivirus.yml:docker-compose.content-converter.yml'

# Read COMPOSE_FILE from deploy/.env when the shell did not already export it.
# Prefer an already-exported value (operator override).
compose_file_from_env_file() {
  local env_file="${1:-}"
  [[ -n "$env_file" && -f "$env_file" ]] || return 0
  local line
  line="$(grep -E '^[[:space:]]*COMPOSE_FILE=' "$env_file" 2>/dev/null | head -1 | sed 's/\r$//' || true)"
  [[ -n "$line" ]] || return 0
  line="${line#COMPOSE_FILE=}"
  line="${line#\"}"
  line="${line%\"}"
  line="${line#\'}"
  line="${line%\'}"
  if [[ -n "$line" ]]; then
    export COMPOSE_FILE="$line"
  fi
}

# Set COMPOSE_FILE for VPS ops scripts. Pass path to deploy/.env optionally.
export_vps_compose_file() {
  local env_file="${1:-}"
  # Provision the private RPC credential before Compose resolves its required value.
  if [[ -n "$env_file" && -f "$env_file" ]]; then
    bash "$(dirname "${BASH_SOURCE[0]}")/ensure-content-converter-env.sh" "$env_file"
  fi
  if [[ -z "${COMPOSE_FILE:-}" && -n "$env_file" ]]; then
    compose_file_from_env_file "$env_file"
  fi
  export COMPOSE_FILE="${COMPOSE_FILE:-$VPS_COMPOSE_FILE_DEFAULT}"
  # Preserve older operator overlays while retaining mandatory content scanning.
  if [[ "$COMPOSE_FILE" != *docker-compose.content-antivirus.yml* ]]; then
    export COMPOSE_FILE="$COMPOSE_FILE:docker-compose.content-antivirus.yml"
  fi
  if [[ "$COMPOSE_FILE" != *docker-compose.content-converter.yml* ]]; then
    export COMPOSE_FILE="$COMPOSE_FILE:docker-compose.content-converter.yml"
  fi
  # Backend-only releases must preserve an already-enabled Knowledge API.
  # An explicit operator value (including 0) takes precedence over detection.
  local knowledge_enabled="${KNOWLEDGE_SYNC_ENABLED:-}"
  if [[ -z "$knowledge_enabled" ]]; then
    knowledge_enabled="$(docker exec agent-os-backend-1 printenv KNOWLEDGE_SYNC_ENABLED 2>/dev/null || true)"
  fi
  if [[ "$knowledge_enabled" == 1 && "$COMPOSE_FILE" != *docker-compose.knowledge-api.yml* ]]; then
    export COMPOSE_FILE="$COMPOSE_FILE:docker-compose.knowledge-api.yml"
  fi
  if [[ "${REQUIRE_VPS_CLIENT_IP:-1}" == "1" && "$COMPOSE_FILE" != *vps-client-ip* ]]; then
    echo "ERROR: COMPOSE_FILE must include docker-compose.vps-client-ip.yml (got: $COMPOSE_FILE)" >&2
    echo "       Host-network nginx proxies to 127.0.0.1:3001/8080; without the overlay login and /api 502." >&2
    return 1
  fi
  echo "COMPOSE_FILE=$COMPOSE_FILE"
}
