#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy

echo "=== verify source ==="
grep -F "Flowlah - An Agent Company Setup" /opt/agent-os/frontend/index.html
grep -F "Flowlah (Automate, Innovate, Elevate)" /opt/agent-os/frontend/src/pages/Login.jsx

echo "=== rebuild frontend ==="
docker compose build --progress=plain frontend

echo "=== recreate frontend + nginx ==="
docker compose up -d --force-recreate frontend nginx
sleep 3

echo "=== verify built title ==="
docker compose exec -T frontend sh -c 'grep -F "Flowlah - An Agent Company Setup" /usr/share/nginx/html/index.html'

echo "=== smoke ==="
curl -kfsS -o /dev/null -w "login_http=%{http_code}\n" https://127.0.0.1/login
curl -kfsS https://127.0.0.1/ | head -c 500
echo
echo DEPLOY_DONE
