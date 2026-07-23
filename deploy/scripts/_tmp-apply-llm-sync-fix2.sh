#!/bin/bash
set -euo pipefail
TS=$(date +%s)

cp -a /opt/agent-os/backend/src/services/platform-llm-settings.js "/tmp/platform-llm-settings.js.bak.$TS" || true
docker cp /tmp/platform-llm-settings.js agent-os-backend-1:/opt/agent-os/backend/src/services/platform-llm-settings.js

cp -a /opt/agent-os/deploy/scripts/configure-openclaw-docker.js "/tmp/configure-openclaw-docker.js.bak.$TS" || true
cp /tmp/configure-openclaw-docker.js /opt/agent-os/deploy/scripts/configure-openclaw-docker.js
docker cp /tmp/configure-openclaw-docker.js agent-os-openclaw-1:/opt/agent-os/deploy/scripts/configure-openclaw-docker.js || true

docker cp /tmp/_tmp-show-oc-llm.js agent-os-openclaw-1:/tmp/_tmp-show-oc-llm.js
docker cp /tmp/_tmp-run-secondary-sync.mjs agent-os-backend-1:/opt/agent-os/backend/_tmp-run-secondary-sync.mjs

echo "=== BEFORE ==="
docker exec agent-os-openclaw-1 node /tmp/_tmp-show-oc-llm.js BEFORE

echo "=== RUN sync secondary ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node _tmp-run-secondary-sync.mjs

echo "=== AFTER ==="
sleep 1
docker exec agent-os-openclaw-1 node /tmp/_tmp-show-oc-llm.js AFTER

echo "=== per-agent model on t-ceo-bala / vedic ==="
docker exec agent-os-openclaw-1 node -e 'const c=require("/root/.openclaw/openclaw.json"); let n=0; for (const a of c.agents.list||[]){ if(/vedic|t-ceo-bala/i.test(a.id||"") && a.model){ console.log(a.id, JSON.stringify(a.model)); n++; } } console.log("explicit_model_count="+n);'
