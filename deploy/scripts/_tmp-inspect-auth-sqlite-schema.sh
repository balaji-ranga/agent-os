#!/bin/bash
set -euo pipefail
OC=agent-os-openclaw-1
AGENT=t-ceo-byok-ollama-1784764718-35f942--balserve
DB="/root/.openclaw/agents/${AGENT}/agent/openclaw-agent.sqlite"

echo "=== sqlite3 available? ==="
docker exec "$OC" sh -c 'which sqlite3 || command -v sqlite3; ls /usr/bin/sqlite3 2>/dev/null; apk info sqlite 2>/dev/null | head -2; dpkg -l sqlite3 2>/dev/null | tail -1'

echo "=== .schema ==="
if docker exec "$OC" sh -c "command -v sqlite3 >/dev/null"; then
  docker exec "$OC" sqlite3 "$DB" ".tables"
  echo "--- SCHEMA ---"
  docker exec "$OC" sqlite3 "$DB" ".schema"
  echo "--- auth_profile_store ---"
  docker exec "$OC" sqlite3 "$DB" "SELECT * FROM auth_profile_store;"
else
  echo "NO sqlite3 in container; using host python on volume"
fi

# Always also dump via host python for reliability / redaction
python3 - <<'PY'
import sqlite3, json, os
p="/var/lib/docker/volumes/agent-os_openclaw_home/_data/agents/t-ceo-byok-ollama-1784764718-35f942--balserve/agent/openclaw-agent.sqlite"
con=sqlite3.connect(f"file:{p}?mode=ro", uri=True)
cur=con.cursor()
print("=== TABLES ===")
tables=[r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
print(tables)
print("=== SCHEMA (CREATE TABLE) ===")
for row in cur.execute("SELECT sql FROM sqlite_master WHERE type='table' ORDER BY name"):
    print(row[0]+";")
print("=== auth_profile_store rows (redacted) ===")
cols=[d[0] for d in cur.execute("PRAGMA table_info(auth_profile_store)").fetchall()]
# pragma returns cid,name,type,... so wrong - fix:
cols=[r[1] for r in cur.execute("PRAGMA table_info(auth_profile_store)")]
print("cols:", cols)
for row in cur.execute("SELECT * FROM auth_profile_store"):
    o=dict(zip(cols,row))
    # redact keys inside store_json
    try:
        j=json.loads(o.get("store_json") or "{}")
        for pid,prof in (j.get("profiles") or {}).items():
            if isinstance(prof, dict) and "key" in prof and isinstance(prof["key"], str):
                k=prof["key"]
                prof["key"]=f"{k[:4]}?REDACTED?(len={len(k)})"
            if isinstance(prof, dict) and "token" in prof and isinstance(prof["token"], str):
                t=prof["token"]
                prof["token"]=f"{t[:4]}?REDACTED?(len={len(t)})"
        o["store_json"]=j
    except Exception as e:
        o["store_json_error"]=str(e)
    print(json.dumps(o, indent=2))
print("=== auth_profile_state (redacted) ===")
cols2=[r[1] for r in cur.execute("PRAGMA table_info(auth_profile_state)")]
for row in cur.execute("SELECT * FROM auth_profile_state"):
    o=dict(zip(cols2,row))
    try:
        o["state_json"]=json.loads(o.get("state_json") or "{}")
    except Exception:
        pass
    print(json.dumps(o, indent=2))
PY

echo "=== find agent dirs WITHOUT auth / with empty sqlite ==="
# Pick a few recent t- agents and check sqlite existence + profile count
python3 - <<'PY'
import os, sqlite3, json, glob
base="/var/lib/docker/volumes/agent-os_openclaw_home/_data/agents"
# Prefer recent tenant agents from same CEO family and a couple others
candidates=[]
for d in sorted(os.listdir(base)):
    if not d.startswith("t-"): continue
    agent_dir=os.path.join(base,d,"agent")
    db=os.path.join(agent_dir,"openclaw-agent.sqlite")
    ap=os.path.join(agent_dir,"auth-profiles.json")
    candidates.append((d, os.path.isdir(agent_dir), os.path.isfile(db), os.path.isfile(ap),
                       os.path.getmtime(agent_dir) if os.path.isdir(agent_dir) else 0))
# sort by mtime desc, take top 15
candidates.sort(key=lambda x: x[4], reverse=True)
print("recent t- agents (mtime desc):")
for d, has_agent, has_db, has_ap, mt in candidates[:15]:
    profiles=None
    if has_db:
        try:
            con=sqlite3.connect(f"file:{os.path.join(base,d,'agent','openclaw-agent.sqlite')}?mode=ro", uri=True)
            row=con.execute("SELECT store_json FROM auth_profile_store LIMIT 1").fetchone()
            if row:
                j=json.loads(row[0])
                profiles=list((j.get("profiles") or {}).keys())
            else:
                profiles=[]
            con.close()
        except Exception as e:
            profiles=f"ERR:{e}"
    print(f"  {d}: agentDir={has_agent} sqlite={has_db} auth-profiles.json={has_ap} profileIds={profiles}")

# Also check if balserve (platform) has sqlite
for d in ["balserve","main"]:
    db=os.path.join(base,d,"agent","openclaw-agent.sqlite")
    print(f"platform {d}: sqlite={os.path.isfile(db)}")
PY

echo "=== openclaw.json: find an agent created for same CEO that may lack sqlite ==="
docker exec "$OC" node -e '
const fs=require("fs");
const c=JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json","utf8"));
const prefix="t-ceo-byok-ollama-1784764718-35f942--";
const list=(c.agents?.list||[]).filter(e=>String(e.id||"").startsWith(prefix)).map(e=>e.id);
console.log("tenant agents for this CEO:", list);
'
