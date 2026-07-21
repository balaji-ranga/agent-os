#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
OCID=$(docker compose ps -q openclaw)
docker cp /tmp/agent-os-content-tools-index.js "${OCID}:/root/.openclaw/extensions/agent-os-content-tools/index.js"

# Re-expand contracts after overwrite
docker compose exec -T openclaw node <<'NODE'
const fs = require('fs');
const tools = JSON.parse(fs.readFileSync('/root/.openclaw/agent-os-tools.json','utf8'));
const names = tools.map(t => t.name).filter(Boolean);
const pluginPath = '/root/.openclaw/extensions/agent-os-content-tools/openclaw.plugin.json';
const plugin = JSON.parse(fs.readFileSync(pluginPath,'utf8'));
plugin.contracts = { ...(plugin.contracts||{}), tools: names };
plugin.activation = { ...(plugin.activation||{}), onStartup: true };
plugin.toolMetadata = plugin.toolMetadata || {};
for (const name of names) plugin.toolMetadata[name] = { ...(plugin.toolMetadata[name]||{}), optional: true };
fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));
console.log('contracts', names.length);
NODE

docker compose restart openclaw
for i in 1 2 3 4 5 6 7 8; do
  O=$(docker inspect -f '{{.State.Health.Status}}' agent-os-openclaw-1 2>/dev/null || echo starting)
  echo "openclaw=$O"
  [ "$O" = healthy ] && break
  sleep 4
done

echo ==== import smoke
docker compose exec -T openclaw node --input-type=module -e '
import("/root/.openclaw/extensions/agent-os-content-tools/index.js")
  .then((m) => console.log("import ok", typeof m.default, Object.keys(m.default||{})))
  .catch((e) => { console.error("import fail", e.message); process.exit(1); });
'

echo ==== runtime tools include workflow list?
docker compose exec -T openclaw openclaw plugins inspect agent-os-content-tools --runtime 2>&1 | grep -E 'agent_workflow_list|Shape:|Capability|Status:'

echo ==== recent unknown-entry warnings
docker compose logs --tail=120 openclaw 2>/dev/null | grep -iE 'unknown entries|agent_workflow_list|content-tools' | tail -30 || true

echo ==== invoke still ok
docker compose exec -T backend sh -c '
  curl -sS --max-time 15 -X POST http://127.0.0.1:3001/api/tools/invoke \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOOLS_API_KEY" \
    -H "x-openclaw-agent-id: balserve" \
    -H "x-openclaw-session-key: agent::balserve:agent-os-balserve-testowner" \
    -H "x-ceo-user-id: testowner" \
    -d "{\"tool_name\":\"agent_workflow_list\",\"caller_agent_id\":\"balserve\"}"
  echo
'
echo DONE
