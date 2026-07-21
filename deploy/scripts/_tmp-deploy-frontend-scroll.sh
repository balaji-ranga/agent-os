#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy

echo "=== ensure frontend source files present ==="
test -f /opt/agent-os/frontend/src/index.css
test -f /opt/agent-os/frontend/src/pages/Register.jsx
grep -q '100dvh' /opt/agent-os/frontend/src/index.css && echo "local source has 100dvh" || echo "MISSING 100dvh in source"

echo
echo "=== rebuild frontend image ==="
docker compose build frontend

echo
echo "=== recreate frontend ==="
docker compose up -d frontend

echo
echo "=== verify built assets contain 100dvh ==="
# wait a moment for container
sleep 2
docker compose exec -T frontend sh -c 'grep -R "100dvh" /usr/share/nginx/html/assets/ 2>/dev/null | head -3 || echo "NO_100dvh_IN_ASSETS"'

echo
docker compose ps frontend
echo DONE
