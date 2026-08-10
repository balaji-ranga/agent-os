#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
# shellcheck source=compose-file-defaults.sh
source /opt/agent-os/deploy/scripts/compose-file-defaults.sh
export_vps_compose_file /opt/agent-os/deploy/.env
echo "BUILD_START $(date -Is)" | tee /tmp/agent-os-build.log
docker compose build 2>&1 | tee -a /tmp/agent-os-build.log
echo "BUILD_EXIT=${PIPESTATUS[0]} $(date -Is)" | tee -a /tmp/agent-os-build.log
