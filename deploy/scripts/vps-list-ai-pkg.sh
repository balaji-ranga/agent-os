#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 sh -c 'ls -la /usr/local/lib/node_modules/openclaw/node_modules/@openclaw/ai'
docker exec agent-os-openclaw-1 sh -c 'ls /usr/local/lib/node_modules/openclaw/node_modules/@openclaw/ai/dist 2>/dev/null | head -30'
docker exec agent-os-openclaw-1 sh -c 'ls /usr/local/lib/node_modules/openclaw/node_modules/@earendil-works 2>/dev/null'
docker exec agent-os-openclaw-1 sh -c 'find /usr/local/lib/node_modules/openclaw/node_modules/@earendil-works -name "*.js" 2>/dev/null | head -30'
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/usr/local/lib/node_modules/openclaw/node_modules/@openclaw/ai/package.json";
console.log(JSON.parse(fs.readFileSync(p,"utf8")).version, JSON.parse(fs.readFileSync(p,"utf8")).main);
'
