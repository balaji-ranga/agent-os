#!/bin/bash
set -euo pipefail
OC=agent-os-openclaw-1

docker exec "$OC" node -e "const c=require('/root/.openclaw/openclaw.json'); const a=c.auth||{}; const hits={}; for (const [k,v] of Object.entries(a.profiles||{})) { if (String(k).includes('byok') || String(v.provider||'').includes('byok')) hits[k]=v; } console.log(JSON.stringify({authProfilesHits:hits, authOrderByok:Object.fromEntries(Object.entries(a.order||{}).filter(([k])=>k.includes('byok'))), authTopKeys:Object.keys(a), profileCount:Object.keys(a.profiles||{}).length},null,2));"

echo "=== upsertAuthProfileWithLock body (writes sqlite) ==="
docker exec "$OC" sed -n '100,200p' /usr/local/lib/node_modules/openclaw/dist/profiles-DyU-YCq2.js

echo "=== resolveAuthStorePathForDisplay ==="
docker exec "$OC" sh -c 'grep -n "auth-profiles.json\|openclaw-agent.sqlite\|resolveAuthStorePath" /usr/local/lib/node_modules/openclaw/dist/auth-profiles-CbpggXoK.js /usr/local/lib/node_modules/openclaw/dist/profiles-DyU-YCq2.js 2>/dev/null | head -30'

echo "=== noninteractive paste dry-run shape (no write) ==="
# just document command; do not overwrite
echo 'printf "%s\n" "ollama" | openclaw models auth --agent <id> paste-api-key --provider <byok-provider>'

echo "=== docs models.md paste note ==="
docker exec "$OC" sed -n '158,175p' /usr/local/lib/node_modules/openclaw/docs/cli/models.md

echo "=== docs oauth storage ==="
docker exec "$OC" sed -n '60,80p' /usr/local/lib/node_modules/openclaw/docs/concepts/oauth.md
