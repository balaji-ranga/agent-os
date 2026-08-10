#!/usr/bin/env bash
# Full bring-up after images are built: restore volumes then start stack.
set -euo pipefail
cd /opt/agent-os/deploy
# shellcheck source=compose-file-defaults.sh
source /opt/agent-os/deploy/scripts/compose-file-defaults.sh
export_vps_compose_file /opt/agent-os/deploy/.env
TRANSFER_DIR=/opt/agent-os-transfer
PROJECT=agent-os

echo "==> Create volumes via short up"
docker compose up -d --no-start || true
docker compose create 2>/dev/null || docker compose up -d --scale backend=0 --scale openclaw=0 --scale frontend=0 --scale nginx=0 2>/dev/null || true

# Ensure named volumes exist
docker volume create "${PROJECT}_agent_os_data" >/dev/null || true
docker volume create "${PROJECT}_openclaw_home" >/dev/null || true
docker volume create "${PROJECT}_workflow_fs" >/dev/null || true

echo "==> Stop services if running"
docker compose stop || true

DATA_VOL="${PROJECT}_agent_os_data"
OC_VOL="${PROJECT}_openclaw_home"

echo "==> Restore SQLite volume ${DATA_VOL}"
docker run --rm \
  -v "${DATA_VOL}:/dest:Z" \
  -v "${TRANSFER_DIR}:/src:ro,Z" \
  alpine:3.20 \
  sh -c 'rm -rf /dest/* /dest/.[!.]* /dest/..?* 2>/dev/null || true; mkdir -p /dest; tar -xf /src/agent-os-data.tar -C /dest; ls -la /dest | head'

echo "==> Restore OpenClaw home ${OC_VOL}"
docker run --rm \
  -v "${OC_VOL}:/dest:Z" \
  -v "${TRANSFER_DIR}:/src:ro,Z" \
  alpine:3.20 \
  sh -c 'rm -rf /dest/* /dest/.[!.]* /dest/..?* 2>/dev/null || true; mkdir -p /tmp/in /dest; tar -xf /src/openclaw-home.tar -C /tmp/in; if [ -d /tmp/in/.openclaw ]; then cp -a /tmp/in/.openclaw/. /dest/; else cp -a /tmp/in/. /dest/; fi; ls /dest | head'

echo "==> Sync openclaw.json tokens from deploy/.env (skip full init to keep restored DB)"
docker compose run --rm --no-deps --entrypoint node openclaw deploy/scripts/configure-openclaw-docker.js || \
  docker compose run --rm --no-deps --entrypoint node openclaw /opt/agent-os/deploy/scripts/configure-openclaw-docker.js || true

echo "==> Start stack"
docker compose up -d

echo "==> Wait for health"
for i in $(seq 1 90); do
  if curl -kfsS https://127.0.0.1/api/health >/dev/null 2>&1; then
    echo "HEALTHY after ${i} tries"
    curl -kfsS https://127.0.0.1/api/health || true
    echo
    break
  fi
  sleep 3
done

docker compose ps
echo BRINGUP_DONE
