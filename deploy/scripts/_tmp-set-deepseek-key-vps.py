#!/usr/bin/env python3
"""Set OPENAI_API_KEY and DeepSeek primary settings in deploy/.env from /tmp/ds-key-only.txt"""
from pathlib import Path

key = Path("/tmp/ds-key-only.txt").read_text(encoding="utf-8").strip()
Path("/tmp/ds-key-only.txt").unlink(missing_ok=True)
if not key:
    raise SystemExit("empty key file")

p = Path("/opt/agent-os/deploy/.env")
wanted = {
    "OPENAI_API_KEY": key,
    "OPENAI_BASE_URL": "https://api.deepseek.com/v1",
    "OPENAI_PRIMARY_BASE_URL": "https://api.deepseek.com/v1",
    "OPENAI_PRIMARY_MODEL": "deepseek-v4-flash",
    "OPENCLAW_MODEL_PRIMARY": "openai/deepseek-v4-flash",
    "OPENCLAW_ENABLE_OLLAMA_FALLBACK": "0",
}
lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
seen = set()
out = []
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        out.append(line)
        continue
    k = stripped.split("=", 1)[0].strip()
    if k in wanted:
        out.append(f"{k}={wanted[k]}")
        seen.add(k)
    else:
        out.append(line)
for k, v in wanted.items():
    if k not in seen:
        out.append(f"{k}={v}")
p.write_text("\n".join(out) + "\n", encoding="utf-8")
print("WROTE_KEY_LEN", len(key))
