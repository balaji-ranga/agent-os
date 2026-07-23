#!/bin/bash
set -euo pipefail
OC=agent-os-openclaw-1
AGENT=t-ceo-byok-ollama-1784764718-35f942--balserve

echo "=== auth.json ==="
docker exec "$OC" cat "/root/.openclaw/agents/$AGENT/agent/auth.json"

echo "=== auth list for agent ==="
docker exec "$OC" openclaw models auth list --agent "$AGENT" 2>&1 || true

echo "=== paste-api-key full help + try --help-all ==="
docker exec "$OC" openclaw models auth paste-api-key -h 2>&1
docker exec "$OC" sh -c 'openclaw models auth paste-api-key --help 2>&1; openclaw --help 2>&1 | head -5'

echo "=== grep paste-api-key impl in dist ==="
docker exec "$OC" sh -c '
PKG=/usr/local/lib/node_modules/openclaw
# find pasteApiKey / paste-api-key implementation snippets
grep -RIn --include="*.js" -E "paste-api-key|pasteApiKey|PasteApiKey" "$PKG/dist" 2>/dev/null | head -40
'

echo "=== extract paste-api-key option parsing from matching files ==="
docker exec "$OC" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dist = '/usr/local/lib/node_modules/openclaw/dist';
const out = execSync(`grep -RIl --include='*.js' 'paste-api-key' ${dist}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
console.log('files:', out);
for (const f of out.slice(0, 8)) {
  const s = fs.readFileSync(f, 'utf8');
  // find command registration chunks
  const idx = s.indexOf('paste-api-key');
  if (idx < 0) continue;
  console.log('\n====', f, 'around paste-api-key ====');
  console.log(s.slice(Math.max(0, idx - 800), idx + 2500));
}
NODE

echo "=== docs mentioning auth-profiles ==="
docker exec "$OC" sh -c '
PKG=/usr/local/lib/node_modules/openclaw
grep -RIn --include="*.md" -E "auth-profiles|paste-api-key|models auth" "$PKG/docs" "$PKG/README.md" 2>/dev/null | head -60
'
