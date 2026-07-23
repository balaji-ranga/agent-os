#!/bin/bash
python3 <<'PY'
import os, sqlite3, json
base="/var/lib/docker/volumes/agent-os_openclaw_home/_data/agents"
for d in [
  "t-ceo-byok-ollama-1784764718-35f942--balserve",
  "t-ceo-byok-ollama-1784764718-35f942--workflowbuilder",
  "t-ceo-byok-ollama-1784764718-35f942--platformhelp",
  "t-ceo-bala--balserve",
  "balserve",
]:
  agent=os.path.join(base,d,"agent")
  print(f"\n=== {d} ===")
  if not os.path.isdir(agent):
    print("NO agent dir"); continue
  print("files:", sorted(os.listdir(agent)))
  db=os.path.join(agent,"openclaw-agent.sqlite")
  if not os.path.isfile(db):
    print("NO sqlite"); continue
  con=sqlite3.connect(f"file:{db}?mode=ro", uri=True)
  row=con.execute("SELECT store_key, store_json, updated_at FROM auth_profile_store").fetchall()
  print("auth_profile_store rows:", len(row))
  for sk, sj, ua in row:
    j=json.loads(sj)
    for pid,prof in (j.get("profiles") or {}).items():
      if isinstance(prof,dict) and isinstance(prof.get("key"),str):
        k=prof["key"]; prof["key"]=f"{k[:4]}?REDACTED?(len={len(k)})"
    print(json.dumps({"store_key":sk,"updated_at":ua,"store_json":j}, indent=2))
  st=con.execute("SELECT COUNT(*) FROM auth_profile_state").fetchone()[0]
  print("auth_profile_state rows:", st)
  con.close()
PY
