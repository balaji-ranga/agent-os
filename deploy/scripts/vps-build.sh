#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
echo "BUILD_START $(date -Is)" | tee /tmp/agent-os-build.log
docker compose build 2>&1 | tee -a /tmp/agent-os-build.log
echo "BUILD_EXIT=${PIPESTATUS[0]} $(date -Is)" | tee -a /tmp/agent-os-build.log
