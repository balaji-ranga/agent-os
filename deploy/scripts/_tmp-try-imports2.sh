#!/bin/bash
set -euo pipefail
cat > /tmp/try-imports.mjs <<'NODE'
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
    console.log('FAIL', c, String(e.message).split('\n')[0]);
  }
}
NODE
docker cp /tmp/try-imports.mjs agent-os-openclaw-1:/tmp/try-imports.mjs
docker exec agent-os-openclaw-1 node /tmp/try-imports.mjs

echo ====
cd /opt/agent-os/deploy
docker compose exec -T openclaw openclaw plugins inspect agent-os-content-tools --runtime 2>&1 | head -100
echo ====
docker compose exec -T openclaw openclaw plugins doctor 2>&1 | head -40
