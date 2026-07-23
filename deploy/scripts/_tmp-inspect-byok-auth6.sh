#!/bin/bash
set -euo pipefail
OC=agent-os-openclaw-1

python3 - <<'PY'
import sqlite3, json
p="/var/lib/docker/volumes/agent-os_openclaw_home/_data/agents/t-ceo-byok-ollama-1784764718-35f942--balserve/agent/openclaw-agent.sqlite"
con=sqlite3.connect(f"file:{p}?mode=ro", uri=True)
con.row_factory=sqlite3.Row
cur=con.cursor()
store=json.loads(cur.execute("SELECT store_json FROM auth_profile_store").fetchone()[0])
state=json.loads(cur.execute("SELECT state_json FROM auth_profile_state").fetchone()[0])
# redact keys
for pid,prof in store.get("profiles",{}).items():
    if isinstance(prof,dict) and "key" in prof:
        k=str(prof["key"])
        prof["key"]=f"{k[:4]}?REDACTED?(len={len(k)})"
print("STORE:", json.dumps(store, indent=2))
print("STATE:", json.dumps(state, indent=2))
PY

# extract functions into /tmp snippets via grep -n and sed
docker exec "$OC" sh -c 'grep -n "function applyAuthProfileConfig\|function readPastedSecret\|async function readPastedSecret\|resolveDefaultTokenProfileId\|upsertAuthProfileWithLock" /usr/local/lib/node_modules/openclaw/dist/*.js 2>/dev/null | head -40'

echo "=== readPastedSecret from auth-BWOx8z9c.js ==="
docker exec "$OC" sh -c 'grep -n "readPastedSecret\|isTTY\|stdin\|createInterface\|password" /usr/local/lib/node_modules/openclaw/dist/auth-BWOx8z9c.js | head -40'

# Dump readPastedSecret by finding export or function in all dist
docker exec "$OC" sh -c '
f=$(grep -Rl "readPastedSecret" /usr/local/lib/node_modules/openclaw/dist --include="*.js" | head -5)
echo files=$f
for f in $f; do
  echo FILE=$f
  # print lines around first definition
  awk "/readPastedSecret|function readPasted|async function readPasted/{c=40} c&&c--{print NR\":\"\$0}" "$f" | head -80
done
'

echo "=== applyAuthProfileConfig ==="
docker exec "$OC" sh -c '
f=$(grep -Rl "function applyAuthProfileConfig" /usr/local/lib/node_modules/openclaw/dist --include="*.js" | head -3)
for f in $f; do
  echo FILE=$f
  awk "/function applyAuthProfileConfig/{c=50} c&&c--{print NR\":\"\$0}" "$f" | head -60
done
'

echo "=== openclaw.json auth after paste ==="
docker exec "$OC" python3 - <<'PY'
import json
c=json.load(open("/root/.openclaw/openclaw.json"))
print("auth=", json.dumps(c.get("auth"), indent=2)[:3000])
agent=[e for e in c.get("agents",{}).get("list",[]) if e.get("id")=="t-ceo-byok-ollama-1784764718-35f942--balserve"]
print("agent=", json.dumps(agent, indent=2)[:2000])
# any auth.profiles mentioning byok-ceo-byok-ollama
ap=(c.get("auth") or {}).get("profiles") or {}
hits={k:v for k,v in ap.items() if "byok-ceo-byok-ollama-1784764718" in k or (isinstance(v,dict) and "byok-ceo-byok-ollama-1784764718" in str(v.get("provider","")))}
print("auth.profiles hits=", json.dumps(hits, indent=2))
order=(c.get("auth") or {}).get("order") or {}
print("auth.order keys sample=", list(order.keys())[:20])
byok_orders={k:v for k,v in order.items() if "byok" in k}
print("byok orders=", json.dumps(byok_orders, indent=2)[:2000])
PY

echo "=== docs gateway authentication store ==="
docker exec "$OC" sed -n '60,100p' /usr/local/lib/node_modules/openclaw/docs/gateway/authentication.md
