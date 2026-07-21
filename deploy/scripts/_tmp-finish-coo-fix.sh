#!/bin/bash
# Finish COO workflow tool fix after partial deploy.
set -euo pipefail
cd /opt/agent-os/deploy

BACKEND_TOOLS=/opt/agent-os/backend/src/routes/tools.js
BACKEND_META=/opt/agent-os/backend/src/services/content-tools-meta.js

echo "=== copy backend patches ==="
BCID=$(docker compose ps -q backend)
OCID=$(docker compose ps -q openclaw)
docker cp /tmp/backend-tools.js "${BCID}:${BACKEND_TOOLS}"
docker cp /tmp/backend-content-tools-meta.js "${BCID}:${BACKEND_META}"
echo "backend files copied"

echo
echo "=== reinstall plugin (volume may still have it; refresh) ==="
docker compose exec -T openclaw mkdir -p /root/.openclaw/extensions/agent-os-content-tools
docker cp /tmp/agent-os-content-tools-index.js "${OCID}:/root/.openclaw/extensions/agent-os-content-tools/index.js"
docker cp /tmp/agent-os-content-tools-plugin.json "${OCID}:/root/.openclaw/extensions/agent-os-content-tools/openclaw.plugin.json"

docker compose exec -T openclaw node <<'NODE'
const fs = require('fs');
const toolsPath = '/root/.openclaw/agent-os-tools.json';
const pluginPath = '/root/.openclaw/extensions/agent-os-content-tools/openclaw.plugin.json';
const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf8'));
const names = tools.map((t) => t.name).filter(Boolean);
const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
plugin.contracts = { ...(plugin.contracts || {}), tools: names };
plugin.activation = { ...(plugin.activation || {}), onStartup: true };
plugin.toolMetadata = plugin.toolMetadata || {};
for (const name of names) {
  plugin.toolMetadata[name] = { ...(plugin.toolMetadata[name] || {}), optional: true };
}
fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));
console.log('contracts.tools', names.length, 'agent_workflow_list', names.includes('agent_workflow_list'));
NODE

echo
echo "=== restart backend + openclaw ==="
docker compose restart backend openclaw
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  B=$(docker inspect -f '{{.State.Health.Status}}' agent-os-backend-1 2>/dev/null || echo starting)
  O=$(docker inspect -f '{{.State.Health.Status}}' agent-os-openclaw-1 2>/dev/null || echo starting)
  echo "  try $i backend=$B openclaw=$O"
  if [ "$B" = healthy ] && [ "$O" = healthy ]; then break; fi
  sleep 5
done

echo
echo "=== plugin info ==="
docker compose exec -T openclaw openclaw plugins info agent-os-content-tools 2>&1 | head -50

echo
echo "=== TOOLS_BASE_URL + getBackendBaseUrl ==="
docker compose exec -T backend sh -c 'echo TOOLS_BASE_URL=$TOOLS_BASE_URL; grep -n "TOOLS_BASE_URL\|getBackendBaseUrl" -A6 '"$BACKEND_TOOLS"' | head -30'

echo
echo "=== invoke agent_workflow_list ==="
docker compose exec -T backend sh -c '
  curl -sS --max-time 20 -X POST http://127.0.0.1:3001/api/tools/invoke \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOOLS_API_KEY" \
    -H "x-openclaw-agent-id: balserve" \
    -H "x-openclaw-session-key: agent::balserve:agent-os-balserve-testowner" \
    -H "x-ceo-user-id: testowner" \
    -d "{\"tool_name\":\"agent_workflow_list\",\"caller_agent_id\":\"balserve\"}" | head -c 2000
  echo
'

echo
echo "=== plugin import ==="
docker compose exec -T openclaw node --input-type=module -e '
import("/root/.openclaw/extensions/agent-os-content-tools/index.js")
  .then((m) => console.log("import ok", typeof m.default, Object.keys(m.default || {})))
  .catch((e) => { console.error("import fail", e); process.exit(1); });
'

echo
echo "=== recent openclaw logs (tools/plugin) ==="
docker compose logs --tail=80 openclaw 2>/dev/null | grep -iE 'content-tools|agent_workflow|unknown entries|Capability|plugin' | tail -40

echo DONE
