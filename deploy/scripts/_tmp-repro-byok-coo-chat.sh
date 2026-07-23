#!/bin/bash
set -euo pipefail
AGENT_ID='t-ceo-ceo-byok-verify-mrwstusj-b56255--balserve'
echo "=== agent entry ==="
docker exec agent-os-openclaw-1 node -e "const c=require('/root/.openclaw/openclaw.json'); const a=(c.agents.list||[]).find(x=>x.id==='$AGENT_ID'); console.log(JSON.stringify(a,null,2)); const p=c.models.providers['byok-ceo-ceo-byok-verify-mrwstusj-b56255']; console.log('provider', JSON.stringify(p,null,2));"

echo "=== auth profile sqlite ==="
docker exec agent-os-openclaw-1 sh -c "ls -la /root/.openclaw/agents/$AGENT_ID/agent/ 2>/dev/null || ls -la /root/.openclaw/agents/ 2>/dev/null | head"
docker exec agent-os-openclaw-1 node -e "
const Database=require('better-sqlite3');
const fs=require('fs');
const path='/root/.openclaw/agents/$AGENT_ID/agent/openclaw-agent.sqlite';
if(!fs.existsSync(path)){ console.log('NO_SQLITE', path); process.exit(0);} 
const db=new Database(path, {readonly:true});
const row=db.prepare(\"SELECT store_json FROM auth_profile_store WHERE store_key='primary'\").get();
console.log(row?row.store_json.slice(0,500):'empty');
"

TOKEN=\$(grep '^OPENCLAW_GATEWAY_TOKEN=' /opt/agent-os/deploy/.env | cut -d= -f2-)
echo "=== gateway chat (30s) ==="
docker exec agent-os-backend-1 node -e "
const token=process.env.OPENCLAW_GATEWAY_TOKEN;
const agent='$AGENT_ID';
const ctrl=new AbortController();
const t=setTimeout(()=>ctrl.abort(), 45000);
try {
  const r=await fetch('http://openclaw:18789/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'x-openclaw-agent-id':agent},
    body:JSON.stringify({model:'openclaw',messages:[{role:'user',content:'Reply with exactly PONG. Do not use tools.'}],user:'diag-byok-'+Date.now(),stream:false}),
    signal:ctrl.signal
  });
  clearTimeout(t);
  const text=await r.text();
  console.log('status', r.status);
  console.log(text.slice(0,800));
} catch(e) {
  clearTimeout(t);
  console.log('FETCH_ERR', e.name, e.message);
}
"

echo "=== backend resolve user ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module -e "
import { initDb, getDb } from './src/db/schema.js';
initDb();
const rows=getDb().prepare('SELECT id,name,email,llm_provider FROM platform_users WHERE id LIKE ?').all('%byok-verify%');
console.log(JSON.stringify(rows,null,2));
"
