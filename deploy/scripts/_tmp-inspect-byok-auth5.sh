#!/bin/bash
set -euo pipefail
OC=agent-os-openclaw-1

echo "=== find sqlite module / cli ==="
docker exec "$OC" sh -c 'which sqlite3; find /usr/local/lib/node_modules/openclaw -name "better-sqlite3" -type d 2>/dev/null | head; ls /usr/local/lib/node_modules/openclaw/node_modules 2>/dev/null | head -20'

echo "=== dump sqlite with python or sqlite3 ==="
DB=/var/lib/docker/volumes/agent-os_openclaw_home/_data/agents/t-ceo-byok-ollama-1784764718-35f942--balserve/agent/openclaw-agent.sqlite
python3 - <<PY
import sqlite3, json
p="$DB"
con=sqlite3.connect(f"file:{p}?mode=ro", uri=True)
con.row_factory=sqlite3.Row
cur=con.cursor()
tables=[r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("tables", tables)
for name in tables:
    cols=[r[1] for r in cur.execute(f"PRAGMA table_info({name})")]
    n=cur.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
    print(f"\nTABLE {name} rows={n} cols={cols}")
    if n==0: continue
    if not any(x in name.lower() for x in ("auth","cred","profile","secret","key","config","meta","kv","store")):
        # still show small tables
        if n>50: continue
    for row in cur.execute(f"SELECT * FROM {name} LIMIT 40"):
        o=dict(row)
        for k,v in list(o.items()):
            if v is None: continue
            s=str(v)
            if any(x in k.lower() for x in ("key","token","secret","password","credential","value","blob","payload")) and len(s)>0:
                o[k]=s[:6]+"?REDACTED?(len="+str(len(s))+")"
            elif len(s)>160:
                o[k]=s[:100]+"?"
        print(json.dumps(o, default=str))
PY

echo "=== applyAuthProfileConfig + readPastedSecret ==="
docker exec "$OC" node <<'NODE'
const fs=require("fs");
const path=require("path");
const {execSync}=require("child_process");
const hits=execSync("grep -RIl --include='*.js' 'function applyAuthProfileConfig\\|function readPastedSecret\\|upsertAuthProfileWithLock' /usr/local/lib/node_modules/openclaw/dist",{encoding:"utf8"}).trim().split("\n");
console.log("hit files", hits.slice(0,15));
for (const f of hits.slice(0,12)) {
  const s=fs.readFileSync(f,"utf8");
  for (const name of ["function applyAuthProfileConfig","async function readPastedSecret","function readPastedSecret","async function upsertAuthProfileWithLock","function upsertAuthProfileWithLock","function resolveDefaultTokenProfileId"]) {
    let idx=0, found=0;
    while ((idx=s.indexOf(name, idx))>=0 && found<2) {
      console.log("\n====", path.basename(f), name, "====");
      console.log(s.slice(idx, idx+2200));
      idx+=name.length; found++;
    }
  }
}
NODE

echo "=== openclaw.json auth ==="
docker exec "$OC" node <<'NODE'
const fs=require("fs");
const c=JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json","utf8"));
console.log(JSON.stringify({
  auth: c.auth || null,
  agentEntryAuth: (c.agents?.list||[]).find(x=>x.id==="t-ceo-byok-ollama-1784764718-35f942--balserve")
}, null, 2).slice(0,4000));
NODE
