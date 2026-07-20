#!/bin/bash
set -euo pipefail
echo "=== fix openai provider api=openai-responses (custom tools) ==="
docker exec agent-os-openclaw-1 node <<'NODE'
const fs = require('fs');
const p = '/root/.openclaw/openclaw.json';
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
if (!c.models) c.models = {};
if (!c.models.providers) c.models.providers = {};
const existing = c.models.providers.openai || {};
const models = (Array.isArray(existing.models) ? existing.models : []).map((m) => {
  if (typeof m === 'string') return { id: m, name: m, api: 'openai-responses' };
  return { ...m, api: 'openai-responses' };
});
const { baseUrl, ...rest } = existing;
c.models.providers.openai = {
  ...rest,
  apiKey: existing.apiKey,
  api: 'openai-responses',
  models,
};
// Prefer no silent ollama fallback for agent tool calling
c.agents = c.agents || {};
c.agents.defaults = c.agents.defaults || {};
c.agents.defaults.model = c.agents.defaults.model || {};
c.agents.defaults.model.primary = c.agents.defaults.model.primary || 'openai/gpt-4o-mini';
c.agents.defaults.model.fallbacks = [];
if (!Array.isArray(c.plugins?.allow)) c.plugins = { ...(c.plugins || {}), allow: [] };
if (!c.plugins.allow.includes('browser')) c.plugins.allow.push('browser');
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log('openai.api', c.models.providers.openai.api);
console.log('openai.baseUrl', c.models.providers.openai.baseUrl);
console.log('fallbacks', c.agents.defaults.model.fallbacks);
NODE

cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
docker compose restart openclaw
for i in $(seq 1 20); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then
    echo "gateway ready"
    break
  fi
  echo "wait $i"; sleep 3
done

TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
echo "=== probe chat ==="
docker exec -e TOKEN="$TOKEN" agent-os-backend-1 node --input-type=module -e '
const tok=process.env.TOKEN;
const res=await fetch("http://openclaw:18789/v1/chat/completions",{
  method:"POST",
  headers:{ "Content-Type":"application/json", Authorization:"Bearer "+tok, "x-openclaw-agent-id":"balserve" },
  body:JSON.stringify({model:"openclaw",messages:[{role:"user",content:"Reply with exactly PONG. Do not use tools."}],user:"diag2-"+Date.now()}),
  signal:AbortSignal.timeout(120000)
});
const t=await res.text();
console.log("status", res.status);
console.log(t.slice(0,600));
if (!res.ok) process.exit(1);
'

echo "=== COO tools e2e ==="
docker exec \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -w /opt/agent-os/backend \
  agent-os-backend-1 \
  node scripts/test-coo-tools-prompt-e2e.js
