#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node --input-type=module <<'NODE'
const candidates = [
  'openclaw/dist/plugin-sdk/plugin-entry.js',
  '/usr/local/lib/node_modules/openclaw/dist/plugin-sdk/plugin-entry.js',
  'file:///usr/local/lib/node_modules/openclaw/dist/plugin-sdk/plugin-entry.js',
];
for (const c of candidates) {
  try {
    const m = await import(c);
    console.log('OK', c, Object.keys(m));
  } catch (e) {
    console.log('FAIL', c, e.message.split('\n')[0]);
  }
}
NODE

# Also check what plugins doctor says
cd /opt/agent-os/deploy
docker compose exec -T openclaw openclaw plugins doctor agent-os-content-tools 2>&1 | head -60
docker compose exec -T openclaw openclaw plugins inspect agent-os-content-tools --runtime 2>&1 | head -80
