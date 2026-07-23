#!/bin/bash
set -euo pipefail

docker cp /tmp/platform-llm-settings.js agent-os-backend-1:/opt/agent-os/backend/src/services/platform-llm-settings.js
docker cp /tmp/configure-openclaw-docker.js agent-os-openclaw-1:/opt/agent-os/deploy/scripts/configure-openclaw-docker.js
docker cp /tmp/_tmp-plat-status.mjs agent-os-backend-1:/opt/agent-os/backend/_plat_status.mjs

docker exec -w /opt/agent-os/backend agent-os-backend-1 node _plat_status.mjs primary

echo "Waiting for gateway reload..."
for i in $(seq 1 30); do
  if docker logs agent-os-openclaw-1 --since 60s 2>&1 | grep -q 'platform-llm-active.json changed\|Starting gateway'; then
    sleep 2
    break
  fi
  sleep 1
done

docker exec -i agent-os-openclaw-1 python3 <<'PY'
import json
from pathlib import Path
c=json.loads(Path("/root/.openclaw/openclaw.json").read_text())
o=((c.get("models") or {}).get("providers") or {}).get("openai") or {}
marker=json.loads(Path("/root/.openclaw/platform-llm-active.json").read_text())
print("defaults", c.get("agents",{}).get("defaults",{}).get("model"))
print("base", o.get("baseUrl"))
print("models", [m.get("id") if isinstance(m,dict) else m for m in (o.get("models") or [])])
print("marker_primary", marker.get("primary"), "active", marker.get("active"))
assert marker.get("primary") == "openai/deepseek-v4-flash", marker
assert (c.get("agents") or {}).get("defaults",{}).get("model",{}).get("primary") == "openai/deepseek-v4-flash"
print("CONFIG_OK")
PY

docker exec -i agent-os-openclaw-1 python3 <<'PY'
import json, os, urllib.request
from pathlib import Path
key=os.environ.get("OPENAI_API_KEY","")
base=os.environ.get("OPENAI_BASE_URL","https://api.deepseek.com/v1").rstrip("/")
rt=Path("/root/.openclaw/platform-llm-runtime.env")
if rt.exists():
  for line in rt.read_text().splitlines():
    if line.startswith("OPENAI_API_KEY="): key=line.split("=",1)[1]
    if line.startswith("OPENAI_BASE_URL="): base=line.split("=",1)[1].rstrip("/")
# Prefer gateway process key
for p in Path("/proc").iterdir():
  if not p.name.isdigit(): continue
  try:
    cmd=(p/"cmdline").read_bytes().replace(b"\0",b" ").decode("utf-8","ignore")
  except Exception:
    continue
  if "openclaw-gateway" not in cmd: continue
  for e in (p/"environ").read_bytes().split(b"\0"):
    if e.startswith(b"OPENAI_API_KEY="): key=e.decode().split("=",1)[1]
    if e.startswith(b"OPENAI_BASE_URL="): base=e.decode().split("=",1)[1].rstrip("/")
body=json.dumps({
  "model":"deepseek-v4-flash",
  "messages":[{"role":"user","content":"Reply with exactly: FLASH_OK"}],
  "max_tokens":64,
  "stream":False,
  "thinking":{"type":"disabled"},
}).encode()
req=urllib.request.Request(base+"/chat/completions", data=body, headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=90) as resp:
  data=json.loads(resp.read().decode())
  msg=((data.get("choices") or [{}])[0].get("message") or {})
  content=str(msg.get("content") or "")
  print("http", resp.status, "model", data.get("model"), "content", repr(content[:200]))
  assert "FLASH_OK" in content, msg
print("FLASH_PROBE_OK")
PY

cat > /tmp/_vedic_flash.mjs <<'EOF'
import { getDb } from './src/db/schema.js';
import { startNewChatSession, sessionUserForThread } from './src/services/chat-session-policy.js';
import { chatCompletions } from './src/gateway/openclaw.js';
const db = getDb();
const agent = db.prepare(`SELECT id, owner_user_id FROM agents WHERE id = ?`).get('vedic-astrology');
const owner = agent.owner_user_id || 'ceo-bala';
const openclawAgentId = 't-ceo-bala--vedic-astrology';
const result = startNewChatSession({ agentId: agent.id, openclawAgentId, ownerUserId: owner });
const sessionUser = sessionUserForThread(agent.id, owner, result.thread_id);
const reply = await chatCompletions(
  openclawAgentId,
  [{ role: 'user', content: 'Which model are you using? Reply with exactly one short line containing MODEL_IS_FLASH. Do not use tools.' }],
  sessionUser,
  false,
  { timeoutMs: 180000 }
);
const text = typeof reply === 'string' ? reply : (reply?.content || reply?.choices?.[0]?.message?.content || JSON.stringify(reply));
console.log(String(text).slice(0, 800));
EOF
docker cp /tmp/_vedic_flash.mjs agent-os-backend-1:/opt/agent-os/backend/_vedic_flash.mjs
docker exec -w /opt/agent-os/backend agent-os-backend-1 node _vedic_flash.mjs
docker logs agent-os-openclaw-1 --since 3m 2>&1 | grep -E 'model-fetch|deepseek-v4-flash|agent model:' | tail -20
echo ALL_FLASH_OK
