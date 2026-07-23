#!/bin/bash
# Robust 2× Admin primary↔secondary round-trips + Vedic probes.
set -euo pipefail
fail=0

gateway_key_info() {
  docker exec -i agent-os-openclaw-1 python3 - <<'PY'
from pathlib import Path
best=None
for line in Path("/proc").iterdir():
    if not line.name.isdigit(): continue
    try:
        cmd=(line/"cmdline").read_bytes().replace(b"\0",b" ").decode("utf-8","ignore")
    except Exception:
        continue
    if "openclaw-gateway" not in cmd: continue
    env=(line/"environ").read_bytes().split(b"\0")
    key=base=""
    for e in env:
        if e.startswith(b"OPENAI_API_KEY="): key=e.decode().split("=",1)[1]
        if e.startswith(b"OPENAI_BASE_URL="): base=e.decode().split("=",1)[1]
    best=(line.name,key,base)
if not best:
    print("NO_GATEWAY")
else:
    pid,key,base=best
    print(f"pid={pid}")
    print(f"key_prefix={key[:10] if key else ''}")
    print(f"key_suffix={key[-4:] if key else ''}")
    print(f"base={base}")
    print(f"is_sk_proj={str(key.startswith('sk-proj')).lower()}")
    print(f"is_deepseek_key={str(key.startswith('sk-') and not key.startswith('sk-proj')).lower()}")
PY
}

switch_to() {
  local which="$1"
  echo ""
  echo "========== SWITCH → $which =========="
  docker exec -w /opt/agent-os/backend agent-os-backend-1 node _plat_status.mjs "$which" | tail -30
  local ok=0
  for i in $(seq 1 40); do
    if docker logs agent-os-openclaw-1 --since 90s 2>&1 | grep -q 'platform-llm-active.json changed'; then
      # wait until gateway process has expected key
      sleep 2
      local info
      info="$(gateway_key_info)"
      echo "gateway@$i: $info"
      if [ "$which" = "secondary" ] && echo "$info" | grep -q 'is_sk_proj=true'; then
        ok=1; break
      fi
      if [ "$which" = "primary" ] && echo "$info" | grep -q 'is_deepseek_key=true'; then
        ok=1; break
      fi
    fi
    sleep 1
  done
  if [ "$ok" != "1" ]; then
    echo "WARN: watcher did not produce correct gateway key — docker restart openclaw"
    docker restart agent-os-openclaw-1
    for i in $(seq 1 40); do
      if docker exec agent-os-openclaw-1 curl -fsS http://127.0.0.1:18789/ >/dev/null 2>&1; then break; fi
      sleep 2
    done
    sleep 2
  fi
  echo "--- post-switch gateway ---"
  gateway_key_info
  docker exec -w /opt/agent-os/backend agent-os-backend-1 node _plat_status.mjs 2>/dev/null | grep -E 'llm_active|effective_primary|defaults|openai |runtime|"active"' || true
}

probe_vedic() {
  local expect="$1"
  local token="$2"
  echo ""
  echo "========== VEDIC PROBE expect=$expect token=$token =========="
  cat > /tmp/_vedic_probe.mjs <<EOF
import { getDb } from './src/db/schema.js';
import { startNewChatSession, sessionUserForThread } from './src/services/chat-session-policy.js';
import { chatCompletions } from './src/gateway/openclaw.js';

const db = getDb();
const agent = db.prepare(\`SELECT id, openclaw_agent_id, owner_user_id FROM agents WHERE id = ?\`).get('vedic-astrology');
const owner = agent.owner_user_id || 'ceo-bala';
const openclawAgentId = 't-ceo-bala--vedic-astrology';
const result = startNewChatSession({ agentId: agent.id, openclawAgentId, ownerUserId: owner });
const sessionUser = sessionUserForThread(agent.id, owner, result.thread_id);
const reply = await chatCompletions(
  openclawAgentId,
  [{ role: 'user', content: 'Which model are you using? Reply with exactly one short line containing the token ${token}. Do not use tools. Do not invent Python scripts or API code.' }],
  sessionUser,
  false,
  { timeoutMs: 180000 }
);
const text = typeof reply === 'string'
  ? reply
  : (reply?.content || reply?.choices?.[0]?.message?.content || reply?.text || JSON.stringify(reply));
console.log('REPLY_START');
console.log(String(text).slice(0, 1500));
console.log('REPLY_END');
EOF
  docker cp /tmp/_vedic_probe.mjs agent-os-backend-1:/opt/agent-os/backend/_vedic_probe.mjs
  local out
  out="$(docker exec -w /opt/agent-os/backend agent-os-backend-1 node _vedic_probe.mjs)"
  echo "$out"
  local body
  body=$(echo "$out" | sed -n '/REPLY_START/,/REPLY_END/p' | sed '1d;$d')
  if echo "$body" | grep -qiE 'notify_ceo|master.?data|API_END_POINT|import json|requests\.post|There is no specific OpenClaw'; then
    echo "FAIL: ollama-style junk"
    fail=1
    return 0
  fi
  if echo "$body" | grep -q "$token"; then
    echo "OK: token present"
  else
    echo "WARN: token missing (paraphrase?)"
  fi
  local logs
  logs=$(docker logs agent-os-openclaw-1 --since 3m 2>&1 | grep -iE 't-ceo-bala--vedic|model-fetch|deepseek|gpt-4o-mini|401|failover|ollama' | tail -30 || true)
  echo "--- logs ---"; echo "$logs"
  if echo "$logs" | grep -qiE 'failover.*ollama|model=ollama|provider=ollama'; then
    echo "FAIL: ollama failover in logs"; fail=1
  fi
  local ginfo
  ginfo="$(gateway_key_info)"
  echo "gateway: $ginfo"
  if [ "$expect" = "openai" ] && ! echo "$ginfo" | grep -q 'is_sk_proj=true'; then
    echo "FAIL: expected sk-proj gateway key"; fail=1
  fi
  if [ "$expect" = "deepseek" ] && ! echo "$ginfo" | grep -q 'is_deepseek_key=true'; then
    echo "FAIL: expected DeepSeek gateway key"; fail=1
  fi
  if [ "$expect" = "openai" ] && ! echo "$logs" | grep -qi 'api.openai.com'; then
    echo "WARN: no api.openai.com in recent logs"
  fi
  if [ "$expect" = "deepseek" ] && ! echo "$logs" | grep -qiE 'deepseek|api.deepseek'; then
    echo "WARN: no deepseek URL in recent logs"
  fi
  if echo "$logs" | grep -qi 'status=401'; then
    echo "FAIL: 401 in logs"; fail=1
  fi
}

# Ensure helper present
if ! docker exec agent-os-backend-1 test -f /opt/agent-os/backend/_plat_status.mjs; then
  echo "missing _plat_status.mjs"; exit 1
fi

echo "=== baseline ==="
gateway_key_info
docker exec -w /opt/agent-os/backend agent-os-backend-1 node _plat_status.mjs || true

switch_to secondary
probe_vedic openai VEDIC_OPENAI_RT1A

switch_to primary
probe_vedic deepseek VEDIC_DEEPSEEK_RT1B

switch_to secondary
probe_vedic openai VEDIC_OPENAI_RT2A

switch_to primary
probe_vedic deepseek VEDIC_DEEPSEEK_RT2B

echo ""
echo "========== SUMMARY fail=$fail =========="
[ "$fail" = "0" ] && echo ALL_SWITCH_TESTS_OK || exit 1
