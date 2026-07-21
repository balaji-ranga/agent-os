#!/bin/bash
# Deploy content-tools definePluginEntry fix + ensure backend TOOLS_BASE_URL loopback.
set -euo pipefail
cd /opt/agent-os/deploy

echo "=== 1) Ensure TOOLS_BASE_URL in deploy/.env ==="
if grep -q '^TOOLS_BASE_URL=' .env 2>/dev/null; then
  sed -i 's|^TOOLS_BASE_URL=.*|TOOLS_BASE_URL=http://127.0.0.1:3001|' .env
else
  printf '\nTOOLS_BASE_URL=http://127.0.0.1:3001\n' >> .env
fi
grep '^TOOLS_BASE_URL=' .env

echo
echo "=== 2) Sync docker-compose TOOLS_BASE_URL if missing ==="
if ! grep -q 'TOOLS_BASE_URL' docker-compose.yml; then
  echo "WARN: docker-compose.yml missing TOOLS_BASE_URL — .env alone may not inject into container"
fi

echo
echo "=== 3) Install plugin files into openclaw volume ==="
CID=$(docker compose ps -q openclaw)
mkdir -p /tmp/oc-ext/agent-os-content-tools
cp -f /tmp/agent-os-content-tools-index.js /tmp/oc-ext/agent-os-content-tools/index.js
cp -f /tmp/agent-os-content-tools-plugin.json /tmp/oc-ext/agent-os-content-tools/openclaw.plugin.json

docker compose exec -T openclaw mkdir -p /root/.openclaw/extensions/agent-os-content-tools
docker cp /tmp/oc-ext/agent-os-content-tools/index.js "${CID}:/root/.openclaw/extensions/agent-os-content-tools/index.js"
docker cp /tmp/oc-ext/agent-os-content-tools/openclaw.plugin.json "${CID}:/root/.openclaw/extensions/agent-os-content-tools/openclaw.plugin.json"

docker compose exec -T openclaw sh -c '
  d=/root/.openclaw/extensions/agent-os-content-tools
  if [ -f "$d/index.ts" ] && [ -f "$d/index.js" ]; then
    mv -f "$d/index.ts" "$d/index.ts.bak"
    echo "renamed index.ts -> index.ts.bak"
  fi
  ls -la "$d"
'

echo
echo "=== 4) Expand contracts.tools from live agent-os-tools.json ==="
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
console.log('contracts.tools count', names.length);
console.log('has agent_workflow_list', names.includes('agent_workflow_list'));
NODE

echo
echo "=== 5) Ensure plugin enabled + baseUrl http://backend:3001 ==="
docker compose exec -T openclaw node <<'NODE'
const fs = require('fs');
const p = '/root/.openclaw/openclaw.json';
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
if (!c.plugins) c.plugins = {};
if (!c.plugins.entries) c.plugins.entries = {};
const prev = c.plugins.entries['agent-os-content-tools'] || {};
c.plugins.entries['agent-os-content-tools'] = {
  ...prev,
  enabled: true,
  config: {
    ...(prev.config || {}),
    baseUrl: (prev.config && prev.config.baseUrl) || 'http://backend:3001',
    apiKey: (prev.config && prev.config.apiKey) || process.env.TOOLS_API_KEY || '',
  },
};
if (!c.plugins.load) c.plugins.load = {};
const paths = new Set(c.plugins.load.paths || []);
paths.add('/root/.openclaw/extensions/agent-os-content-tools');
c.plugins.load.paths = [...paths];
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log('enabled', c.plugins.entries['agent-os-content-tools'].enabled);
console.log('baseUrl', c.plugins.entries['agent-os-content-tools'].config.baseUrl);
console.log('hasApiKey', !!c.plugins.entries['agent-os-content-tools'].config.apiKey);
NODE

echo
echo "=== 6) Recreate backend with TOOLS_BASE_URL + patch JS ==="
docker compose up -d --force-recreate backend
BCID=$(docker compose ps -q backend)
if [ -f /tmp/backend-tools.js ]; then
  docker cp /tmp/backend-tools.js "${BCID}:/opt/agent-os/backend/src/routes/tools.js"
  echo "copied tools.js"
fi
if [ -f /tmp/backend-content-tools-meta.js ]; then
  docker cp /tmp/backend-content-tools-meta.js "${BCID}:/opt/agent-os/backend/src/services/content-tools-meta.js"
  echo "copied content-tools-meta.js"
fi
docker compose restart backend openclaw
echo "waiting for healthy..."
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  B=$(docker inspect -f '{{.State.Health.Status}}' agent-os-backend-1 2>/dev/null || echo starting)
  O=$(docker inspect -f '{{.State.Health.Status}}' agent-os-openclaw-1 2>/dev/null || echo starting)
  echo "  try $i backend=$B openclaw=$O"
  if [ "$B" = healthy ] && [ "$O" = healthy ]; then break; fi
  sleep 5
done

echo
echo "=== 7) Verify plugin shape ==="
docker compose exec -T openclaw openclaw plugins info agent-os-content-tools 2>&1 | head -50

echo
echo "=== 8) Verify TOOLS_BASE_URL + invoke ==="
docker compose exec -T backend sh -c 'echo TOOLS_BASE_URL=$TOOLS_BASE_URL; grep -n getBackendBaseUrl -A8 /app/src/routes/tools.js | head -20'
docker compose exec -T backend sh -c '
  curl -sS --max-time 20 -X POST http://127.0.0.1:3001/api/tools/invoke \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOOLS_API_KEY" \
    -H "x-openclaw-agent-id: balserve" \
    -H "x-openclaw-session-key: agent::balserve:agent-os-balserve-testowner" \
    -H "x-ceo-user-id: testowner" \
    -d "{\"tool_name\":\"agent_workflow_list\",\"caller_agent_id\":\"balserve\"}" | head -c 1500
  echo
'

echo
echo "=== 9) Plugin import smoke ==="
docker compose exec -T openclaw node --input-type=module -e '
import("/root/.openclaw/extensions/agent-os-content-tools/index.js")
  .then((m) => console.log("import ok", typeof m.default, m.default && Object.keys(m.default || {})))
  .catch((e) => { console.error("import fail", e); process.exit(1); });
'

echo DONE
