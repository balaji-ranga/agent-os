#!/bin/bash
set -euo pipefail

echo "=== gateway process environ OPENAI_* ==="
docker exec agent-os-openclaw-1 sh -c '
pid=$(pgrep -f "openclaw gateway" | head -1)
echo "pid=$pid"
if [ -n "$pid" ]; then
  tr "\0" "\n" < /proc/$pid/environ | grep -E "^OPENAI_" | sed -E "s/(KEY=)(.{10}).{4,}(.{4})$/\1\2...\3/"
fi
'

echo "=== responses probe using gateway process key ==="
docker exec agent-os-openclaw-1 python3 - <<'PY'
import os, json, urllib.request
from pathlib import Path

# Prefer gateway process env
key = None
for line in Path("/proc").iterdir():
    if not line.name.isdigit():
        continue
    try:
        cmdline = (line / "cmdline").read_bytes().decode("utf-8", "ignore")
    except Exception:
        continue
    if "openclaw" in cmdline and "gateway" in cmdline:
        env = (line / "environ").read_bytes().split(b"\0")
        for e in env:
            if e.startswith(b"OPENAI_API_KEY="):
                key = e.decode().split("=", 1)[1]
                break
        if key:
            break

if not key:
    # fallback config
    c = json.loads(Path("/root/.openclaw/openclaw.json").read_text())
    key = ((c.get("models") or {}).get("providers") or {}).get("openai") or {}).get("apiKey")

print("using key", key[:10] + "..." + key[-4:], "len", len(key))
assert key.startswith("sk-proj"), key[:12]

body = json.dumps({
    "model": "gpt-4o-mini",
    "input": "Reply with exactly: OK_SECONDARY",
    "max_output_tokens": 32,
}).encode()
req = urllib.request.Request(
    "https://api.openai.com/v1/responses",
    data=body,
    headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as resp:
    data = json.loads(resp.read().decode())
    print("status", resp.status)
    # extract output text
    texts = []
    for item in data.get("output") or []:
        for c in item.get("content") or []:
            if c.get("type") in ("output_text", "text") and c.get("text"):
                texts.append(c["text"])
    print("output", " | ".join(texts) or data.get("output_text") or str(data)[:400])
PY

echo "=== find vedic agent id in backend sqlite/pg ==="
docker exec -i -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module <<'NODE'
import { getDb } from './src/db/schema.js';
const db = getDb();
const rows = db.prepare(`SELECT id, name, openclaw_agent_id, owner_user_id FROM agents WHERE id LIKE '%vedic%' OR name LIKE '%vedic%' OR openclaw_agent_id LIKE '%vedic%' LIMIT 20`).all();
console.log(JSON.stringify(rows, null, 2));
const bala = db.prepare(`SELECT id, email, role FROM users WHERE id='ceo-bala' OR email LIKE '%bala%' LIMIT 10`).all();
console.log('users', JSON.stringify(bala, null, 2));
NODE
