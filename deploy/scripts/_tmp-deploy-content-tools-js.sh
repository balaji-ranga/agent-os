#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
CID=$(docker compose ps -q openclaw)

echo "=== install compiled plugin JS ==="
mkdir -p /tmp/oc-ext/agent-os-content-tools /tmp/oc-ext/agent-os-bootstrap-watcher
# files already scp'd next to this script location expectations:
cp -f /tmp/agent-os-content-tools-index.js /tmp/oc-ext/agent-os-content-tools/index.js
cp -f /tmp/agent-os-bootstrap-watcher-index.js /tmp/oc-ext/agent-os-bootstrap-watcher/index.js

docker cp /tmp/oc-ext/agent-os-content-tools/index.js ${CID}:/root/.openclaw/extensions/agent-os-content-tools/index.js
# bootstrap watcher dir may be missing on volume — create from image/repo path if needed
docker compose exec -T openclaw sh -c '
  mkdir -p /root/.openclaw/extensions/agent-os-content-tools /root/.openclaw/extensions/agent-os-bootstrap-watcher
  ls -la /root/.openclaw/extensions/agent-os-content-tools/
'
docker cp /tmp/oc-ext/agent-os-bootstrap-watcher/index.js ${CID}:/root/.openclaw/extensions/agent-os-bootstrap-watcher/index.js

# Ensure plugin.json exists for bootstrap watcher
docker compose exec -T openclaw sh -c '
  if [ ! -f /root/.openclaw/extensions/agent-os-bootstrap-watcher/openclaw.plugin.json ]; then
    cat > /root/.openclaw/extensions/agent-os-bootstrap-watcher/openclaw.plugin.json <<EOF
{
  "id": "agent-os-bootstrap-watcher",
  "name": "Agent OS Bootstrap Watcher",
  "description": "Reload workspace MD files from disk on every agent bootstrap.",
  "version": "1.0.0",
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} }
}
EOF
  fi
  # copy plugin json for content-tools if missing
  ls -la /root/.openclaw/extensions/agent-os-content-tools/
  ls -la /root/.openclaw/extensions/agent-os-bootstrap-watcher/
'

echo
echo "=== ensure plugins.enabled in openclaw.json ==="
docker compose exec -T openclaw node <<'NODE'
const fs=require('fs');
const p='/root/.openclaw/openclaw.json';
const c=JSON.parse(fs.readFileSync(p,'utf8'));
if (!c.plugins) c.plugins={};
if (!c.plugins.entries) c.plugins.entries={};
c.plugins.entries['agent-os-content-tools']={
  ...(c.plugins.entries['agent-os-content-tools']||{}),
  enabled: true,
  config: {
    ...((c.plugins.entries['agent-os-content-tools']||{}).config||{}),
    baseUrl: ((c.plugins.entries['agent-os-content-tools']||{}).config||{}).baseUrl || 'http://backend:3001',
    apiKey: ((c.plugins.entries['agent-os-content-tools']||{}).config||{}).apiKey || process.env.TOOLS_API_KEY || '',
  },
};
c.plugins.entries['agent-os-bootstrap-watcher']={
  ...(c.plugins.entries['agent-os-bootstrap-watcher']||{}),
  enabled: true,
  config: {},
};
if (!c.plugins.load) c.plugins.load={};
c.plugins.load.paths=[
  '/root/.openclaw/extensions/agent-os-content-tools',
  '/root/.openclaw/extensions/agent-os-bootstrap-watcher',
];
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log('plugins.load.paths', c.plugins.load.paths);
console.log('content-tools enabled', c.plugins.entries['agent-os-content-tools'].enabled, 'hasKey', !!c.plugins.entries['agent-os-content-tools'].config.apiKey);
NODE

echo
echo "=== restart openclaw ==="
docker compose restart openclaw
sleep 8
docker compose logs --tail=40 openclaw 2>/dev/null | grep -iE 'plugin|content-tools|listening|error|tools.allow' | tail -30

echo
echo "=== test: do allowlists still say unknown agent_workflow_list? ==="
# Trigger a lightweight agent turn isn't easy; inspect registered plugins via gateway if possible
docker compose exec -T openclaw sh -c 'ls -la /root/.openclaw/extensions/agent-os-content-tools/; head -5 /root/.openclaw/extensions/agent-os-content-tools/index.js'

echo
echo "=== backend workflow list invoke ==="
docker compose exec -T backend sh -c '
  curl -sS --max-time 20 -X POST http://127.0.0.1:3001/api/tools/invoke \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOOLS_API_KEY" \
    -H "x-openclaw-agent-id: balserve" \
    -H "x-openclaw-session-key: agent::balserve:agent-os-balserve-ceo-bala" \
    -H "x-ceo-user-id: ceo-bala" \
    -d "{\"tool_name\":\"agent_workflow_list\",\"caller_agent_id\":\"balserve\",\"chat_only\":false}" | head -c 2000
  echo
'
echo DONE
