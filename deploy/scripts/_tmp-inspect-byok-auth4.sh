#!/bin/bash
set -euo pipefail
OC=agent-os-openclaw-1

echo "=== host volume auth files ==="
BASE=/var/lib/docker/volumes/agent-os_openclaw_home/_data/agents/t-ceo-byok-ollama-1784764718-35f942--balserve/agent
ls -la --time-style=full-iso "$BASE"
echo "auth-profiles.json:"; cat "$BASE/auth-profiles.json"; echo
echo "auth.json:"; cat "$BASE/auth.json"; echo

echo "=== sqlite via openclaw better-sqlite3 ==="
docker exec "$OC" node -e '
const Database = require("/usr/local/lib/node_modules/openclaw/node_modules/better-sqlite3");
const p="/root/.openclaw/agents/t-ceo-byok-ollama-1784764718-35f942--balserve/agent/openclaw-agent.sqlite";
const db=new Database(p, {readonly:true});
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='\''table'\''").all();
console.log("tables", tables.map(t=>t.name));
for (const t of tables) {
  const name=t.name;
  const cols=db.prepare(`PRAGMA table_info(${name})`).all().map(c=>c.name);
  const n=db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get().c;
  console.log(`\nTABLE ${name} rows=${n} cols=${cols.join(",")}`);
  if (!/auth|cred|profile|secret|key/i.test(name) && n===0) continue;
  if (!/auth|cred|profile|secret|key|config|meta/i.test(name)) continue;
  const rows=db.prepare(`SELECT * FROM ${name} LIMIT 30`).all();
  for (const r of rows) {
    const o={...r};
    for (const [k,v] of Object.entries(o)) {
      if (v==null) continue;
      const s=String(v);
      if (/key|token|secret|password|credential|value|blob/i.test(k) && s.length>0)
        o[k]=s.slice(0,6)+"?REDACTED?(len="+s.length+")";
      else if (s.length>120) o[k]=s.slice(0,80)+"?";
    }
    console.log(JSON.stringify(o));
  }
}
'

echo "=== applyAuthProfileConfig + readPastedSecret snippets ==="
docker exec "$OC" node -e '
const fs=require("fs");
const files=["/usr/local/lib/node_modules/openclaw/dist/auth-BWOx8z9c.js","/usr/local/lib/node_modules/openclaw/dist/auth-profiles-CbpggXoK.js","/usr/local/lib/node_modules/openclaw/dist/auth-profiles-BFnI-y_7.js"];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const s=fs.readFileSync(f,"utf8");
  for (const name of ["function applyAuthProfileConfig","function readPastedSecret","function upsertAuthProfileWithLock","resolveDefaultTokenProfileId","AUTH_PROFILES"]) {
    const idx=s.indexOf(name);
    if (idx>=0) {
      console.log("\n====", f, name, "====");
      console.log(s.slice(idx, idx+1800));
    }
  }
}
'

echo "=== openclaw.json auth section related to byok agent ==="
docker exec "$OC" node -e '
const fs=require("fs");
const c=JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json","utf8"));
console.log("auth keys", c.auth ? Object.keys(c.auth) : null);
console.log("auth.profiles sample", JSON.stringify(c.auth?.profiles||{}, null, 2).slice(0,2000));
console.log("auth.order sample", JSON.stringify(c.auth?.order||{}, null, 2).slice(0,1500));
const agent="t-ceo-byok-ollama-1784764718-35f942--balserve";
const e=(c.agents?.list||[]).find(x=>x.id===agent);
console.log("agent.auth?", e?.auth);
console.log("agents.defaults.auth?", c.agents?.defaults?.auth);
'

echo "=== gateway authentication.md store note ==="
docker exec "$OC" sed -n "50,90p" /usr/local/lib/node_modules/openclaw/docs/gateway/authentication.md
