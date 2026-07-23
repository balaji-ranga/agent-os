#!/bin/bash
set -euo pipefail

echo "=== find gateway pid + probe openai ==="
docker exec -i agent-os-openclaw-1 python3 - <<'PY'
from pathlib import Path
import json, urllib.request

key = None
pid = None
for line in Path("/proc").iterdir():
    if not line.name.isdigit():
        continue
    try:
        cmdline = (line / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "ignore")
    except Exception:
        continue
    if "gateway" in cmdline and ("openclaw" in cmdline or "node" in cmdline):
        print("candidate", line.name, cmdline[:140])
        try:
            env = (line / "environ").read_bytes().split(b"\0")
        except Exception:
            continue
        for e in env:
            if e.startswith(b"OPENAI_API_KEY="):
                key = e.decode().split("=", 1)[1]
                pid = line.name
                print("OPENAI_API_KEY", key[:10] + "..." + key[-4:], "len", len(key))
                for e2 in env:
                    if e2.startswith(b"OPENAI_BASE_URL="):
                        print("OPENAI_BASE_URL", e2.decode().split("=", 1)[1])
                break
        if key:
            break

c = json.loads(Path("/root/.openclaw/openclaw.json").read_text())
prov = ((c.get("models") or {}).get("providers") or {}).get("openai") or {}
cfg_key = str(prov.get("apiKey") or "")
print("config key", (cfg_key[:10] + "..." + cfg_key[-4:]) if cfg_key else "(none)")
print("gateway_pid", pid)

use = key or cfg_key
assert use.startswith("sk-proj"), "expected sk-proj, got " + use[:12]
print("PROBE_KEY_OK", use[:10] + "..." + use[-4:])

body = json.dumps({
    "model": "gpt-4o-mini",
    "input": "Reply with exactly: OK_SECONDARY",
    "max_output_tokens": 32,
}).encode()
req = urllib.request.Request(
    "https://api.openai.com/v1/responses",
    data=body,
    headers={"Authorization": "Bearer " + use, "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as resp:
    raw = resp.read().decode()
    data = json.loads(raw)
    print("http", resp.status)
    texts = []
    for item in data.get("output") or []:
        for part in item.get("content") or []:
            if part.get("text"):
                texts.append(part["text"])
    print("text", " | ".join(texts) or raw[:500])
PY

echo "=== startNewChatSession + vedic chatCompletions ==="
docker exec -i -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module <<'NODE'
import { getDb } from './src/db/schema.js';
import { startNewChatSession, sessionUserForThread } from './src/services/chat-session-policy.js';
import { chatCompletions } from './src/gateway/openclaw.js';

const db = getDb();
const agent = db.prepare(`SELECT id, openclaw_agent_id, owner_user_id FROM agents WHERE id = ?`).get('vedic-astrology');
const owner = agent.owner_user_id || 'ceo-bala';
const openclawAgentId = 't-ceo-bala--vedic-astrology';
const result = startNewChatSession({
  agentId: agent.id,
  openclawAgentId,
  ownerUserId: owner,
});
console.log('newSession', result);
const sessionUser = sessionUserForThread(agent.id, owner, result.thread_id);
console.log('sessionUser', sessionUser);

const reply = await chatCompletions(
  openclawAgentId,
  [{ role: 'user', content: 'Say exactly: VEDIC_GPT4O_OK. Do not use tools. One short line only.' }],
  sessionUser,
  false,
  { timeoutMs: 120000 }
);
const text = typeof reply === 'string'
  ? reply
  : (reply?.choices?.[0]?.message?.content || reply?.text || JSON.stringify(reply));
console.log('reply', String(text).slice(0, 1000));
NODE

echo "=== recent openclaw auth/fallback logs ==="
docker logs agent-os-openclaw-1 --since 8m 2>&1 | grep -Ei '401|sk-07|fallback|ollama|gpt-4o-mini|VEDIC_GPT4O|model-fetch|Authentication|Honoring' | tail -50 || true
