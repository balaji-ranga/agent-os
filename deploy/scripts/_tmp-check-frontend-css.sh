#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
echo "=== frontend CSS check ==="
docker compose exec -T frontend sh -c 'grep -R "100dvh\|auth-scroll" /usr/share/nginx/html/assets/ 2>/dev/null | head -5 || echo NO_100dvh'
ls /usr/share/nginx/html/assets/*.css 2>/dev/null | head -3 || docker compose exec -T frontend ls /usr/share/nginx/html/assets/ | head
