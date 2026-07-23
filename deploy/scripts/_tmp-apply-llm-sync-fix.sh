#!/bin/bash
set -euo pipefail
TS=$(date +%s)

cp -a /opt/agent-os/backend/src/services/platform-llm-settings.js "/tmp/platform-llm-settings.js.bak.$TS"
docker cp /tmp/platform-llm-settings.js agent-os-backend-1:/opt/agent-os/backend/src/services/platform-llm-settings.js
# Also update host tree if backend mounts from image (copy into image FS via docker cp above is enough)

cp -a /opt/agent-os/deploy/scripts/configure-openclaw-docker.js "/tmp/configure-openclaw-docker.js.bak.$TS"
cp /tmp/configure-openclaw-docker.js /opt/agent-os/deploy/scripts/configure-openclaw-docker.js
docker cp /tmp/configure-openclaw-docker.js agent-os-openclaw-1:/opt/agent-os/deploy/scripts/configure-openclaw-docker.js || true

echo "=== BEFORE ==="
docker exec agent-os-openclaw-1 node <<'NODE'
const c = require('/root/.openclaw/openclaw.json');
const p = c.models.providers.openai || {};
console.log(JSON.stringify({
  defaults: c.agents.defaults.model,
  openai: {
    baseUrl: p.baseUrl || null,
    api: p.api,
    key: (p.apiKey || '').slice(0, 7) + '...',
    models: (p.models || []).map((m) => m.id || m).slice(0, 8),
  },
}, null, 2));
NODE

echo "=== RUN setPlatformLlmActiveEndpoint(secondary) ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module <<'NODE'
import {
  setPlatformLlmActiveEndpoint,
  getPlatformLlmStatusPublic,
} from './src/services/platform-llm-settings.js';
const r = setPlatformLlmActiveEndpoint('secondary');
console.log(JSON.stringify({ openclaw: r.openclaw, status: getPlatformLlmStatusPublic() }, null, 2));
NODE

echo "=== AFTER ==="
sleep 1
docker exec agent-os-openclaw-1 node <<'NODE'
const fs = require('fs');
const c = require('/root/.openclaw/openclaw.json');
const p = c.models.providers.openai || {};
let marker = null;
try { marker = JSON.parse(fs.readFileSync('/root/.openclaw/platform-llm-active.json', 'utf8')); } catch {}
console.log(JSON.stringify({
  defaults: c.agents.defaults.model,
  openai: {
    baseUrl: p.baseUrl || null,
    api: p.api,
    key: (p.apiKey || '').slice(0, 7) + '...',
    models: (p.models || []).map((m) => m.id || m).slice(0, 8),
  },
  marker,
}, null, 2));
NODE

echo "=== vedic agent model fields (should be absent) ==="
docker exec agent-os-openclaw-1 node <<'NODE'
const c = require('/root/.openclaw/openclaw.json');
for (const a of c.agents.list || []) {
  if (/vedic|ceo-bala/i.test(a.id || '')) {
    if (a.model) console.log(a.id, JSON.stringify(a.model));
  }
}
console.log('(no per-agent model lines above means inherit defaults)');
NODE
