#!/bin/bash
set -euo pipefail
# Copy host configure script into running openclaw container (image may be stale), apply, restart.
HOST_CFG=/opt/agent-os/deploy/scripts/configure-openclaw-docker.js
docker cp "$HOST_CFG" agent-os-openclaw-1:/opt/agent-os/deploy/scripts/configure-openclaw-docker.js
echo "=== configure logs ==="
docker exec agent-os-openclaw-1 node /opt/agent-os/deploy/scripts/configure-openclaw-docker.js
echo "=== result ==="
docker exec agent-os-openclaw-1 node -e 'const c=require("/root/.openclaw/openclaw.json"); const o=c.models.providers.openai||{}; console.log(JSON.stringify({primary:c.agents.defaults.model.primary,fallbacks:c.agents.defaults.model.fallbacks,api:o.api,baseUrl:o.baseUrl,models:(o.models||[]).map(m=>m.id||m),hasKey:!!o.apiKey},null,2));'
# Restart openclaw so gateway reloads config
cd /opt/agent-os/deploy
docker compose restart openclaw
sleep 8
bash /tmp/verify-deepseek-openclaw.sh
