#!/bin/bash
# Fix COO tools: 1) plugin contracts + prefer index.js  2) verify self-fetch base URL
set -euo pipefail
cd /opt/agent-os/deploy

echo "=== backend base URL for tool self-fetch ==="
docker compose exec -T backend sh -c '
  echo AGENT_OS_BASE_URL=$AGENT_OS_BASE_URL
  echo AGENT_OS_PUBLIC_URL=$AGENT_OS_PUBLIC_URL
  node --input-type=module -e "
    const mod = await import(\"./src/routes/tools.js\").catch(()=>null);
  " 2>/dev/null || true
  # find getBackendBaseUrl
  node --input-type=module <<'"'"'NODE'"'"'
import { createRequire } from "module";
// inline copy of likely helper
const base = process.env.AGENT_OS_INTERNAL_URL || process.env.AGENT_OS_BASE_URL || process.env.AGENT_OS_PUBLIC_URL || "http://127.0.0.1:3001";
console.log("would use", base);
try {
  const r = await fetch(base.replace(/\/$/,"") + "/health", { signal: AbortSignal.timeout(5000) });
  console.log("health", r.status);
} catch (e) {
  console.log("health fail", e.message);
}
try {
  const r = await fetch("http://127.0.0.1:3001/health", { signal: AbortSignal.timeout(5000) });
  console.log("loopback health", r.status);
} catch (e) {
  console.log("loopback fail", e.message);
}
NODE
'

# Build tools contract list from agent-os-tools.json
TOOLS_JSON=$(docker compose exec -T openclaw cat /root/.openclaw/agent-os-tools.json)
docker compose exec -T openclaw node <<NODE
const fs = require('fs');
const tools = JSON.parse(fs.readFileSync('/root/.openclaw/agent-os-tools.json','utf8'));
const names = tools.map(t => t.name).filter(Boolean);
const pluginPath = '/root/.openclaw/extensions/agent-os-content-tools/openclaw.plugin.json';
const plugin = JSON.parse(fs.readFileSync(pluginPath,'utf8'));
plugin.contracts = { tools: names };
plugin.activation = { onStartup: true };
fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));
console.log('Wrote contracts.tools count', names.length);

// Prefer index.js over index.ts
const dir = '/root/.openclaw/extensions/agent-os-content-tools';
if (fs.existsSync(dir + '/index.ts') && fs.existsSync(dir + '/index.js')) {
  fs.renameSync(dir + '/index.ts', dir + '/index.ts.bak');
  console.log('Renamed index.ts -> index.ts.bak so index.js is used');
}
const bw = '/root/.openclaw/extensions/agent-os-bootstrap-watcher';
if (fs.existsSync(bw + '/index.ts') && fs.existsSync(bw + '/index.js')) {
  fs.renameSync(bw + '/index.ts', bw + '/index.ts.bak');
  console.log('Renamed bootstrap index.ts -> .bak');
}
NODE

echo
echo "=== set AGENT_OS_INTERNAL loopback for tool self-invoke if public URL breaks fetch ==="
# Patch running backend env is hard; instead ensure invoke uses 127.0.0.1 via a one-line check in code.
# Quick runtime fix: if public URL fetch fails, document for compose. For now test both.

docker compose exec -T backend sh -c '
  KEY="$TOOLS_API_KEY"
  for BASE in "http://127.0.0.1:3001" "$AGENT_OS_PUBLIC_URL" "$AGENT_OS_BASE_URL"; do
    [ -n "$BASE" ] || continue
    BASE=$(echo "$BASE" | sed "s#/\$##")
    echo "TRY $BASE"
    curl -sS --max-time 8 -o /tmp/out.json -w "http=%{http_code}\n" -X POST "$BASE/api/tools/invoke" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $KEY" \
      -H "x-openclaw-agent-id: balserve" \
      -H "x-openclaw-session-key: agent::balserve:agent-os-balserve-ceo-bala" \
      -H "x-ceo-user-id: ceo-bala" \
      -d "{\"tool_name\":\"agent_workflow_list\",\"caller_agent_id\":\"balserve\"}" || echo curl_fail
    head -c 300 /tmp/out.json; echo; echo
  done
'

echo
echo "=== restart openclaw to reload plugin contracts ==="
docker compose restart openclaw
sleep 8
docker compose exec -T openclaw openclaw plugins info agent-os-content-tools 2>&1 | head -30
docker compose logs --tail=25 openclaw 2>/dev/null | grep -iE 'plugin|content-tools|listening|contracts' | tail -20
echo DONE
