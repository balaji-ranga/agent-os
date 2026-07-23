#!/usr/bin/env python3
"""Validate DeepSeek from /opt/agent-os/deploy/.env — no secrets printed."""
from pathlib import Path
import json
import urllib.request

def load_env(path):
    env = {}
    for raw in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env

env = load_env("/opt/agent-os/deploy/.env")
key = (env.get("OPENAI_API_KEY") or env.get("OPENAI_PRIMARY_API_KEY") or "").strip()
base = (env.get("OPENAI_BASE_URL") or env.get("OPENAI_PRIMARY_BASE_URL") or "").rstrip("/")
model = (env.get("OPENAI_PRIMARY_MODEL") or "deepseek-v4-flash").strip()
print("key_len", len(key), "base", base, "model", model)
if not key:
    raise SystemExit("NO_KEY")
if "deepseek" not in base:
    raise SystemExit("BASE_NOT_DEEPSEEK")
url = base + "/chat/completions" if base.endswith("/v1") else base + "/v1/chat/completions"
body = json.dumps(
    {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with exactly PONG"}],
        "thinking": {"type": "disabled"},
        "max_tokens": 16,
    }
).encode()
req = urllib.request.Request(
    url,
    data=body,
    headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=60) as r:
    data = json.loads(r.read().decode())
    print("status", r.status)
print("reply", ((data.get("choices") or [{}])[0].get("message") or {}).get("content", "")[:80])
print("VPS_DEEPSEEK_OK")
