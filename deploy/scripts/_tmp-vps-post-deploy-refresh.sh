#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
echo "==> npm install (mammoth/xlsx/astronomy-engine) in backend image"
docker compose exec -T backend npm install --omit=dev mammoth xlsx astronomy-engine 2>/dev/null || \
  docker compose exec -T backend npm install mammoth xlsx astronomy-engine

echo "==> specialty agents for Balaji"
docker compose exec -T backend node scripts/vps-onboard-specialty-agents-bala.js

echo "==> generate_chart + vedic smoke"
docker compose exec -T backend node scripts/test-generate-chart.js
docker compose exec -T backend node scripts/test-vedic-compute-chart.js

echo "==> office extract smoke"
docker compose exec -T backend node scripts/test-master-data-office-extract.js

echo "==> frontend markers"
docker compose exec -T frontend sh -c 'grep -Rql chat-attach-icon-btn /usr/share/nginx/html/assets/*.js && echo AttachIcon=OK || echo AttachIcon=MISSING'
echo "POST_DEPLOY_DONE"
