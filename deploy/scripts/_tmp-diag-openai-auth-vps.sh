#!/bin/bash
set -euo pipefail

echo "=== sk-07 grep under openclaw volume ==="
docker exec agent-os-openclaw-1 grep -R "sk-07" /root/.openclaw 2>/dev/null | head -40 || echo "(none in files)"

echo "=== list openclaw root ==="
docker exec agent-os-openclaw-1 ls -la /root/.openclaw | head -50

echo "=== auth sqlite for vedic ==="
docker exec agent-os-openclaw-1 sh -c 'ls -la /root/.openclaw/agents/t-ceo-bala--vedic-astrology/agent/ 2>/dev/null || echo no-vedic-agent-dir'
docker exec agent-os-openclaw-1 sh -c '
if command -v sqlite3 >/dev/null; then
  for db in /root/.openclaw/agents/t-ceo-bala--vedic-astrology/agent/*.sqlite /root/.openclaw/agents/*/agent/*.sqlite; do
    [ -f "$db" ] || continue
    echo "DB $db"
    sqlite3 "$db" "SELECT store_key, substr(store_json,1,200) FROM auth_profile_store LIMIT 5;" 2>/dev/null || true
  done
else
  echo "no sqlite3 cli"
fi
' || true

echo "=== how openclaw starts ==="
docker inspect agent-os-openclaw-1 --format '{{json .Config.Cmd}} {{json .Config.Entrypoint}} {{json .HostConfig.Binds}}' | head -c 2000
echo
docker exec agent-os-openclaw-1 sh -c 'ls /opt/agent-os/deploy/scripts/configure-openclaw-docker.js; head -5 /opt/agent-os/deploy/docker/openclaw* 2>/dev/null; ls /docker-entrypoint* 2>/dev/null; cat /opt/agent-os/deploy/docker/openclaw-entrypoint.sh 2>/dev/null | head -80'
