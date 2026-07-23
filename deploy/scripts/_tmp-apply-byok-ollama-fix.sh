#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy

echo "==> unload deepseek-r1 if loaded"
docker exec agent-os-backend-1 node -e 'fetch("http://ollama:11434/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"deepseek-r1:8b",keep_alive:0})}).then(r=>r.text()).then(t=>console.log("unload",String(t).slice(0,80))).catch(e=>console.log("unload_skip",e.message))' || true

echo "==> ensure OLLAMA_MODEL + context env"
grep -q '^OLLAMA_MODEL=' .env && sed -i 's/^OLLAMA_MODEL=.*/OLLAMA_MODEL=llama3.2/' .env || echo 'OLLAMA_MODEL=llama3.2' >> .env
grep -q '^OLLAMA_CONTEXT_WINDOW=' .env || echo 'OLLAMA_CONTEXT_WINDOW=32768' >> .env

echo "==> recreate backend + openclaw"
docker cp /opt/agent-os/deploy/scripts/configure-openclaw-docker.js agent-os-openclaw-1:/opt/agent-os/deploy/scripts/configure-openclaw-docker.js || true
docker compose up -d --force-recreate --no-deps backend openclaw
sleep 20

echo "==> resync BYOK ollama"
docker cp /tmp/resync-byok-ollama.js agent-os-backend-1:/opt/agent-os/backend/scripts/_tmp-resync-byok-ollama.js
docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/_tmp-resync-byok-ollama.js

echo "==> reconfigure openclaw"
docker cp /opt/agent-os/deploy/scripts/configure-openclaw-docker.js agent-os-openclaw-1:/opt/agent-os/deploy/scripts/configure-openclaw-docker.js
docker exec agent-os-openclaw-1 node /opt/agent-os/deploy/scripts/configure-openclaw-docker.js
docker compose restart openclaw
sleep 15

echo "==> verify ollama context"
docker exec agent-os-openclaw-1 node -e 'const c=require("/root/.openclaw/openclaw.json"); console.log(JSON.stringify(c.models.providers.ollama,null,2));'

echo "==> smoke BYOK COO chat"
AGENT_ID='t-ceo-ceo-byok-verify-mrwstusj-b56255--balserve'
cat > /tmp/byok-chat2.js <<'JS'
const token = process.env.OPENCLAW_GATEWAY_TOKEN;
const agent = process.env.AGENT_ID;
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 120000);
try {
  const r = await fetch('http://openclaw:18789/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'x-openclaw-agent-id': agent,
    },
    body: JSON.stringify({
      model: 'openclaw',
      messages: [{ role: 'user', content: 'Hi' }],
      user: 'diag-byok-hi-' + Date.now(),
      stream: false,
    }),
    signal: ctrl.signal,
  });
  clearTimeout(t);
  console.log('status', r.status);
  console.log((await r.text()).slice(0, 500));
} catch (e) {
  clearTimeout(t);
  console.log('FETCH_ERR', e.name, e.message);
}
JS
docker cp /tmp/byok-chat2.js agent-os-backend-1:/tmp/byok-chat2.js
docker exec -e AGENT_ID="$AGENT_ID" agent-os-backend-1 node /tmp/byok-chat2.js
echo "BYOK_OLLAMA_FIX_DONE"
