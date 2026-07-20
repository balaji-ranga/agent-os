#!/usr/bin/env bash
# Restore local SQLite + OpenClaw home into running Compose volumes.
# Expects tarballs at /opt/agent-os-transfer/agent-os-data.tar and openclaw-home.tar
# Run AFTER first `docker compose up` so volumes exist, then recreate backend/openclaw.
set -euo pipefail

TRANSFER_DIR="${TRANSFER_DIR:-/opt/agent-os-transfer}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/agent-os/deploy}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.browser.yml"

cd "${DEPLOY_DIR}"

echo "==> Stopping backend + openclaw for volume restore"
${COMPOSE} stop backend openclaw || true

restore_named_volume() {
  local vol="$1"
  local tarpath="$2"
  local mountdir="$3"
  if [[ ! -f "${tarpath}" ]]; then
    echo "Missing ${tarpath}" >&2
    return 1
  fi
  echo "==> Restoring ${vol} from ${tarpath}"
  docker run --rm \
    -v "${vol}:/dest:Z" \
    -v "${TRANSFER_DIR}:/src:ro,Z" \
    alpine:3.20 \
    sh -c "rm -rf /dest/* /dest/.[!.]* /dest/..?* 2>/dev/null || true; mkdir -p /dest; tar -xf /src/$(basename "${tarpath}") -C /dest"
  echo "Restored ${vol}"
}

# Compose project name is agent-os → volumes agent-os_agent_os_data, agent-os_openclaw_home
PROJECT="${COMPOSE_PROJECT_NAME:-agent-os}"
DATA_VOL="${PROJECT}_agent_os_data"
OC_VOL="${PROJECT}_openclaw_home"

# agent-os-data.tar was packed from backend/data (contains agent-os.db + tenants/)
# Volume mount is /data/agent-os — extract so agent-os.db is at volume root
restore_named_volume "${DATA_VOL}" "${TRANSFER_DIR}/agent-os-data.tar" /data/agent-os

# openclaw-home.tar was packed from C:\Users\balaj containing .openclaw/
# Extract then move contents to volume root
echo "==> Restoring ${OC_VOL}"
docker run --rm \
  -v "${OC_VOL}:/dest:Z" \
  -v "${TRANSFER_DIR}:/src:ro,Z" \
  alpine:3.20 \
  sh -c 'rm -rf /dest/* /dest/.[!.]* /dest/..?* 2>/dev/null || true; mkdir -p /tmp/in /dest; tar -xf /src/openclaw-home.tar -C /tmp/in; if [ -d /tmp/in/.openclaw ]; then cp -a /tmp/in/.openclaw/. /dest/; else cp -a /tmp/in/. /dest/; fi'

echo "==> Starting backend + openclaw"
${COMPOSE} up -d backend openclaw nginx frontend

echo "==> Health"
sleep 5
curl -kfsS https://127.0.0.1/api/health || curl -kfsS https://127.0.0.1/health || true
echo
${COMPOSE} ps
echo "Restore complete."
