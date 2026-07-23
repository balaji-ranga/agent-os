#!/bin/bash
set -euo pipefail

echo "=== BEFORE (key prefixes only) ==="
docker exec agent-os-openclaw-1 python3 - <<'PY'
import json,os
from pathlib import Path
c=json.loads(Path("/root/.openclaw/openclaw.json").read_text())
p=((c.get("models") or {}).get("providers") or {}).get("openai") or {}
k=str(p.get("apiKey") or "")
print("providers.openai", (k[:10]+"..."+k[-4:]) if k else "(none)", "base", p.get("baseUrl"))
print("env OPENAI_API_KEY", (os.environ.get("OPENAI_API_KEY","")[:10]+"..."+os.environ.get("OPENAI_API_KEY","")[-4:]) if os.environ.get("OPENAI_API_KEY") else "(none)")
print("env OPENAI_SECONDARY", (os.environ.get("OPENAI_SECONDARY_API_KEY","")[:10]+"..."+os.environ.get("OPENAI_SECONDARY_API_KEY","")[-4:]) if os.environ.get("OPENAI_SECONDARY_API_KEY") else "(none)")
m=Path("/root/.openclaw/platform-llm-active.json")
print("marker", m.read_text() if m.exists() else "(none)")
PY

echo "=== install patched scripts into image FS + host tree ==="
cp -a /tmp/openclaw-entrypoint.sh /opt/agent-os/deploy/docker/openclaw-entrypoint.sh
cp -a /tmp/configure-openclaw-docker.js /opt/agent-os/deploy/scripts/configure-openclaw-docker.js
cp -a /tmp/platform-llm-settings.js /opt/agent-os/backend/src/services/platform-llm-settings.js

docker cp /tmp/openclaw-entrypoint.sh agent-os-openclaw-1:/entrypoint.sh
docker cp /tmp/configure-openclaw-docker.js agent-os-openclaw-1:/opt/agent-os/deploy/scripts/configure-openclaw-docker.js
docker cp /tmp/platform-llm-settings.js agent-os-backend-1:/opt/agent-os/backend/src/services/platform-llm-settings.js

echo "=== setPlatformLlmActiveEndpoint(secondary) via backend ==="
docker exec -i -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module <<'NODE'
import {
  setPlatformLlmActiveEndpoint,
  getPlatformLlmStatusPublic,
} from './src/services/platform-llm-settings.js';
const r = setPlatformLlmActiveEndpoint('secondary');
const k = r?.endpoints?.primary?.apiKey || '';
console.log(JSON.stringify({
  llm_active_endpoint: r.llm_active_endpoint,
  openclaw: r.openclaw,
  effectiveKeyPrefix: k ? (k.slice(0,10)+'...'+k.slice(-4)) : '(none)',
  status: getPlatformLlmStatusPublic(),
}, null, 2));
NODE

echo "=== runtime env after sync ==="
docker exec agent-os-openclaw-1 sh -c 'cat /root/.openclaw/platform-llm-runtime.env | sed -E "s/(KEY=)(.{10}).*/\1\2.../"'

echo "=== restart openclaw ==="
cd /opt/agent-os/deploy
docker compose restart openclaw
for i in $(seq 1 30); do
  if docker exec agent-os-openclaw-1 curl -fsS http://127.0.0.1:18789/ >/dev/null 2>&1; then
    echo "gateway up after ${i}s"
    break
  fi
  sleep 2
done
sleep 2

echo "=== AFTER restart logs (honor secondary?) ==="
docker logs agent-os-openclaw-1 --tail 60 2>&1 | grep -E 'Honoring platform|Sourced |providers.openai|OPENAI_API_KEY|secondary|primary=' || true

echo "=== AFTER key prefixes ==="
docker exec agent-os-openclaw-1 python3 - <<'PY'
import json,os
from pathlib import Path
c=json.loads(Path("/root/.openclaw/openclaw.json").read_text())
p=((c.get("models") or {}).get("providers") or {}).get("openai") or {}
k=str(p.get("apiKey") or "")
print("providers.openai", (k[:10]+"..."+k[-4:]) if k else "(none)")
print("env OPENAI_API_KEY", (os.environ.get("OPENAI_API_KEY","")[:10]+"..."+os.environ.get("OPENAI_API_KEY","")[-4:]) if os.environ.get("OPENAI_API_KEY") else "(none)")
assert k.startswith("sk-proj"), f"bad config key {k[:10]}"
assert os.environ.get("OPENAI_API_KEY","").startswith("sk-proj"), f"bad env key {os.environ.get('OPENAI_API_KEY','')[:10]}"
print("ASSERT_OK config+env are sk-proj")
PY

echo "=== OpenAI responses probe with env key ==="
docker exec agent-os-openclaw-1 python3 - <<'PY'
import os, json, urllib.request
key=os.environ["OPENAI_API_KEY"]
print("probe key", key[:10]+"..."+key[-4:])
body=json.dumps({
  "model":"gpt-4o-mini",
  "input":"Reply with exactly: OK_SECONDARY",
  "max_output_tokens":32,
}).encode()
req=urllib.request.Request(
  "https://api.openai.com/v1/responses",
  data=body,
  headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"},
  method="POST",
)
try:
  with urllib.request.urlopen(req, timeout=60) as resp:
    data=resp.read().decode()
    print("status", resp.status)
    print(data[:600])
except Exception as e:
  if hasattr(e, 'read'):
    print("error", e)
    print(e.read().decode()[:600])
  else:
    raise
  raise SystemExit(1)
PY

echo "=== DONE ==="
