#!/bin/bash
set -uo pipefail
AGENT_ID='t-ceo-ceo-byok-verify-mrwstusj-b56255--balserve'
echo "=== auth-profiles.json ==="
docker exec agent-os-openclaw-1 cat "/root/.openclaw/agents/${AGENT_ID}/agent/auth-profiles.json" 2>/dev/null || true
echo
cat > /tmp/byok-chat.js <<'JS'
const token = process.env.OPENCLAW_GATEWAY_TOKEN;
const agent = process.env.AGENT_ID;
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 90000);
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
      messages: [{ role: 'user', content: 'Reply with exactly PONG. Do not use tools.' }],
      user: 'diag-byok-' + Date.now(),
      stream: false,
    }),
    signal: ctrl.signal,
  });
  clearTimeout(t);
  console.log('status', r.status);
  console.log((await r.text()).slice(0, 1500));
} catch (e) {
  clearTimeout(t);
  console.log('FETCH_ERR', e.name, e.message);
}
JS
docker cp /tmp/byok-chat.js agent-os-backend-1:/tmp/byok-chat.js
echo "=== gateway chat ==="
docker exec -e AGENT_ID="$AGENT_ID" agent-os-backend-1 node /tmp/byok-chat.js
echo "=== openclaw logs ==="
docker logs agent-os-openclaw-1 --tail 50 2>&1 | tail -50
