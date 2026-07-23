#!/bin/bash
set -euo pipefail
echo "=== models ==="
curl -fsS http://127.0.0.1:11434/api/tags 2>/dev/null | head -c 500 || docker exec agent-os-ollama-1 curl -fsS http://127.0.0.1:11434/api/tags | head -c 500
echo
echo "=== try llama3.2 chat ==="
docker exec agent-os-backend-1 node -e '
const r=await fetch("http://ollama:11434/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer ollama"},body:JSON.stringify({model:"llama3.2",messages:[{role:"user",content:"Hi"}],max_tokens:16})});
console.log("status",r.status, await r.text().then(t=>t.slice(0,300)));
' || true
echo "=== try deepseek-r1:8b chat ==="
docker exec agent-os-backend-1 node -e '
const r=await fetch("http://ollama:11434/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer ollama"},body:JSON.stringify({model:"deepseek-r1:8b",messages:[{role:"user",content:"Hi"}],max_tokens:16})});
console.log("status",r.status, await r.text().then(t=>t.slice(0,300)));
' || true
echo "=== ceos with ollama BYOK ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
initDb();
const rows = getDb().prepare(
  `SELECT id, name, email, llm_provider FROM platform_users WHERE llm_provider LIKE '%ollama%' OR llm_provider = 'deepseek' ORDER BY id`
).all();
console.log(JSON.stringify(rows, null, 2));
NODE
echo "=== tenant balserve model for byok verify ==="
docker exec agent-os-openclaw-1 node -e '
const c=require("/root/.openclaw/openclaw.json");
const list=(c.agents&&c.agents.list)||[];
const hits=list.filter(a=>String(a.id||"").includes("byok")||String(a.id||"").includes("verify"));
console.log(JSON.stringify(hits.map(a=>({id:a.id,model:a.model})),null,2));
'
