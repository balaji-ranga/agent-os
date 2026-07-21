#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node <<'NODE'
const fs = require('fs');
const path = '/usr/local/lib/node_modules/openclaw/dist/tool-plugin-BMP6-oiq.js';
const s = fs.readFileSync(path, 'utf8');
const i = s.indexOf('function defineToolPlugin');
console.log(s.slice(i, i + 4500));
console.log('\n==== definePluginEntry from core ====\n');
const coreDir = '/usr/local/lib/node_modules/openclaw/dist/plugin-sdk';
const files = fs.readdirSync(coreDir).filter((f) => f.includes('core') && f.endsWith('.d.ts'));
console.log('core dts', files.slice(0, 20));
NODE

# Also dump a simpler stock plugin that uses definePluginEntry
docker exec agent-os-openclaw-1 sh -c 'rg -l "definePluginEntry" /usr/local/lib/node_modules/openclaw/dist/extensions --glob "*.js" | head -5'
