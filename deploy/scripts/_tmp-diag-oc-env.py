#!/usr/bin/env python3
from pathlib import Path
import json, re

p = Path("/root/.openclaw/.env")
print("=== .openclaw/.env ===")
print(p.read_text() if p.exists() else "(missing)")

print("=== credentials ===")
cred = Path("/root/.openclaw/credentials")
if cred.exists():
    for f in cred.iterdir():
        print(f.name, f.stat().st_size)
        t = f.read_text(errors="ignore")
        keys = sorted(set(re.findall(r"sk-[A-Za-z0-9_-]{6,}", t)))
        for m in keys:
            print(" key", m[:10] + "..." + m[-4:], len(m))
        print(t[:400].replace("\n", "\\n"))

print("=== openclaw.json auth profiles with openai ===")
c = json.loads(Path("/root/.openclaw/openclaw.json").read_text())
auth = c.get("auth") or {}
profiles = auth.get("profiles") or {}
print("profile_count", len(profiles))
for pid, pr in profiles.items():
    blob = json.dumps(pr)
    if "openai" in str(pid).lower() or "openai" in blob.lower() or "sk-" in blob:
        tok = str(pr.get("key") or pr.get("apiKey") or pr.get("token") or "")
        print("profile", pid, "prefix", (tok[:10] + "..." + tok[-4:]) if tok else "(none)", "keys", sorted(set(re.findall(r"sk-[A-Za-z0-9_-]{6,}", blob))))

prov = ((c.get("models") or {}).get("providers") or {}).get("openai") or {}
k = str(prov.get("apiKey") or "")
print("providers.openai.keyPrefix", (k[:10] + "..." + k[-4:]) if k else "(none)")
