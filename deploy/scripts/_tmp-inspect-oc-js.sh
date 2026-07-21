#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
HTML=$(docker compose exec -T backend node -e "
fetch('http://openconnector:3000/').then(r=>r.text()).then(t=>process.stdout.write(t)).catch(e=>{console.error(e);process.exit(1)});
" 2>/dev/null || true)
echo "=== HTML ==="
echo "$HTML"
ASSET=$(echo "$HTML" | grep -oE '/assets/index-[^.]+\.js' | head -1)
echo "ASSET=$ASSET"
JS=$(docker compose exec -T backend node -e "
fetch('http://openconnector:3000${ASSET}').then(r=>r.text()).then(t=>process.stdout.write(t)).catch(e=>{console.error(e);process.exit(1)});
" 2>/dev/null || true)
echo "=== /api strings ==="
echo "$JS" | tr '"' '\n' | grep '^/api' | sort -u | head -30
echo "=== fetch paths ==="
echo "$JS" | tr "'" '\n' | grep '^/api' | sort -u | head -30
echo "=== len ==="
echo "${#JS}"
echo "=== api mentions ==="
echo "$JS" | grep -o 'api/[a-zA-Z0-9_/-]*' | sort -u | head -30
echo "=== Request failed ==="
echo "$JS" | grep -o 'Request failed[^"]*' | head -5
