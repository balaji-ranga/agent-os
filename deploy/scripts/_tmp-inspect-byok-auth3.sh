#!/bin/bash
set -euo pipefail
OC=agent-os-openclaw-1

echo "=== extract modelsAuthPasteApiKeyCommand ==="
docker exec "$OC" node -e '
const fs=require("fs");
const s=fs.readFileSync("/usr/local/lib/node_modules/openclaw/dist/auth-BWOx8z9c.js","utf8");
const start=s.indexOf("async function modelsAuthPasteApiKeyCommand");
const end=s.indexOf("async function modelsAuthPasteTokenCommand", start);
console.log(s.slice(start, end>0?end:start+6000));
'

echo "=== models-cli action wiring ==="
docker exec "$OC" node -e '
const fs=require("fs");
const s=fs.readFileSync("/usr/local/lib/node_modules/openclaw/dist/models-cli-CAi2m9di.js","utf8");
const idx=s.indexOf("paste-api-key");
console.log(s.slice(idx-200, idx+900));
'

echo "=== docs snippet paste-api-key automation ==="
docker exec "$OC" sed -n "150,185p" /usr/local/lib/node_modules/openclaw/docs/cli/models.md

echo "=== oauth.md per-agent path ==="
docker exec "$OC" sed -n "60,90p" /usr/local/lib/node_modules/openclaw/docs/concepts/oauth.md

echo "=== agent-workspace.md auth path ==="
docker exec "$OC" sed -n "100,130p" /usr/local/lib/node_modules/openclaw/docs/concepts/agent-workspace.md

echo "=== sqlite auth tables for agent ==="
docker exec "$OC" node -e '
const Database = require("better-sqlite3");
const p="/root/.openclaw/agents/t-ceo-byok-ollama-1784764718-35f942--balserve/agent/openclaw-agent.sqlite";
const db=new Database(p, {readonly:true});
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type=\"table\"").all();
console.log("tables", tables.map(t=>t.name));
for (const t of tables) {
  const name=t.name;
  if (!/auth|cred|profile|secret/i.test(name)) continue;
  console.log("\nTABLE", name);
  const cols=db.prepare(`PRAGMA table_info(${name})`).all();
  console.log("cols", cols.map(c=>c.name).join(","));
  const rows=db.prepare(`SELECT * FROM ${name} LIMIT 20`).all();
  for (const r of rows) {
    const o={...r};
    for (const [k,v] of Object.entries(o)) {
      if (typeof v==="string" && /key|token|secret|password|credential/i.test(k)) o[k]=String(v).slice(0,4)+"?REDACTED?(len="+v.length+")";
      if (typeof v==="string" && v.length>80) o[k]=v.slice(0,40)+"?";
    }
    console.log(JSON.stringify(o));
  }
}
'

echo "=== host volume paths ==="
ls -la /var/lib/docker/volumes/agent-os_openclaw_home/_data/agents/t-ceo-byok-ollama-1784764718-35f942--balserve/agent/
cat /var/lib/docker/volumes/agent-os_openclaw_home/_data/agents/t-ceo-byok-ollama-1784764718-35f942--balserve/agent/auth-profiles.json
echo
cat /var/lib/docker/volumes/agent-os_openclaw_home/_data/agents/t-ceo-byok-ollama-1784764718-35f942--balserve/agent/auth.json
echo

echo "=== auth-profiles.runtime path helpers ==="
docker exec "$OC" node -e '
const fs=require("fs");
const s=fs.readFileSync("/usr/local/lib/node_modules/openclaw/dist/agents/auth-profiles.runtime.js","utf8");
console.log(s.slice(0, 2500));
'
