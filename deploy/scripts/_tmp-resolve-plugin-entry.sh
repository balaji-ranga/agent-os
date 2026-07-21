#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node <<'NODE'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('/usr/local/lib/node_modules/openclaw/package.json','utf8'));
const exports = pkg.exports || {};
const keys = Object.keys(exports).filter(k => /plugin/i.test(k));
console.log('plugin exports:\n' + keys.join('\n'));
console.log('---');
console.log('plugin-entry export:', JSON.stringify(exports['./plugin-sdk/plugin-entry'] || exports['./plugin-sdk/plugin-entry.js'] || null, null, 2));
const dir = '/usr/local/lib/node_modules/openclaw/dist/plugin-sdk';
const files = fs.readdirSync(dir).filter(f => /plugin-entry/i.test(f));
console.log('plugin-entry files', files);
NODE

echo ====
docker exec agent-os-openclaw-1 sh -c 'ls /usr/local/lib/node_modules/openclaw/dist/plugin-sdk | grep -i entry | head'
echo ====
# How does OpenClaw resolve imports for load.paths plugins?
docker exec agent-os-openclaw-1 sh -c 'grep -R "createJiti\|plugin-sdk\|resolvePlugin" /usr/local/lib/node_modules/openclaw/dist/*.js 2>/dev/null | head -5 || true'
# Try import with NODE_PATH
docker exec agent-os-openclaw-1 sh -c 'NODE_PATH=/usr/local/lib/node_modules node --input-type=module -e "import(\"openclaw/plugin-sdk/plugin-entry\").then(m=>console.log(\"ok\",Object.keys(m))).catch(e=>console.error(e.message))"'
