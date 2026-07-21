#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy

echo "=== title in container ==="
docker compose exec -T frontend grep "Flowlah" /usr/share/nginx/html/index.html

echo "=== footer in assets ==="
if docker compose exec -T frontend sh -c 'grep -Rq "Automate, Innovate, Elevate" /usr/share/nginx/html/assets/'; then
  echo FOOTER_PRESENT
else
  echo FOOTER_MISSING — rebuilding without cache
  # Ensure build context sees updated sources
  ls -la /opt/agent-os/frontend/index.html /opt/agent-os/frontend/src/pages/Login.jsx
  grep Flowlah /opt/agent-os/frontend/index.html
  grep Flowlah /opt/agent-os/frontend/src/pages/Login.jsx
  docker compose build --no-cache frontend
  docker compose up -d --force-recreate frontend nginx
  sleep 4
  docker compose exec -T frontend grep "Flowlah" /usr/share/nginx/html/index.html
  docker compose exec -T frontend sh -c 'grep -Rq "Automate, Innovate, Elevate" /usr/share/nginx/html/assets/ && echo FOOTER_OK || echo FOOTER_STILL_MISSING'
fi

echo "=== public smoke ==="
curl -kfsSL https://127.0.0.1/ -o /tmp/home.html -w "home=%{http_code}\n"
grep "Flowlah - An Agent Company Setup" /tmp/home.html
curl -kfsSL -o /dev/null -w "login=%{http_code}\n" https://127.0.0.1/login
echo DONE
