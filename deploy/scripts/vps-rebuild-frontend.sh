#!/usr/bin/env bash
# Rebuild frontend image on VPS after auth-scroll fix, then run regression scripts in backend.
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml

echo "==> Rebuild frontend"
docker compose build frontend
docker compose up -d --force-recreate frontend nginx
sleep 4
curl -kfsS https://127.0.0.1/api/health
echo
# Register page should be scrollable HTML shell (SPA) — just verify route serves
curl -kfsS -o /dev/null -w "register_http=%{http_code}\n" https://127.0.0.1/register
curl -kfsS https://127.0.0.1/assets/ 2>/dev/null | head -c 20 || true
echo
echo FRONTEND_DONE
