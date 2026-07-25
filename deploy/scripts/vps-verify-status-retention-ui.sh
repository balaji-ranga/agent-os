#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml}"
ok=0
if docker compose exec -T frontend sh -c 'grep -Rql "Run status checker" /usr/share/nginx/html/assets/*.js'; then
  echo OK_status_btn; ok=$((ok+1))
else
  echo FAIL_status_btn
fi
if docker compose exec -T frontend sh -c 'grep -Rql "COO Status Report" /usr/share/nginx/html/assets/*.js'; then
  echo OK_status_modal; ok=$((ok+1))
else
  echo FAIL_status_modal
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Purge data older" /usr/share/nginx/html/assets/*.js'; then
  echo OK_purge; ok=$((ok+1))
else
  echo FAIL_purge
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Data persistence" /usr/share/nginx/html/assets/*.js'; then
  echo OK_profile; ok=$((ok+1))
else
  echo FAIL_profile
fi
if docker compose exec -T frontend sh -c 'grep -Rql "storage_mb\|Storage (MB)" /usr/share/nginx/html/assets/*.js'; then
  echo OK_storage; ok=$((ok+1))
else
  echo FAIL_storage
fi
echo "FRONTEND_MARKERS=$ok/5"
test "$ok" -eq 5
