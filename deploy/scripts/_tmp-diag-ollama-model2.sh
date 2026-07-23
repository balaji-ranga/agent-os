#!/bin/bash
set -euo pipefail
echo "=== models via backend ==="
docker exec agent-os-backend-1 node -e 'const r=await fetch("http://ollama:11434/api/tags"); console.log(await r.text());'
echo "=== try llama3.2 ==="
docker exec agent-os-backend-1 node -e 'const r=await fetch("http://ollama:11434/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer ollama"},body:JSON.stringify({model:"llama3.2",messages:[{role:"user",content:"Hi"}],max_tokens:16})}); console.log("status",r.status); console.log((await r.text()).slice(0,400));'
echo "=== try deepseek-r1:8b ==="
docker exec agent-os-backend-1 node -e 'const r=await fetch("http://ollama:11434/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer ollama"},body:JSON.stringify({model:"deepseek-r1:8b",messages:[{role:"user",content:"Hi"}],max_tokens:16})}); console.log("status",r.status); console.log((await r.text()).slice(0,400));'
echo "=== ceos ollama/deepseek ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module -e 'import { initDb, getDb } from "./src/db/schema.js"; initDb(); console.log(JSON.stringify(getDb().prepare("SELECT id, name, email, llm_provider FROM platform_users WHERE llm_provider IN (\"ollama_free\",\"deepseek\",\"ollama\")").all(),null,2));'
echo "=== byok verify agents ==="
docker exec agent-os-openclaw-1 node -e 'const c=require("/root/.openclaw/openclaw.json"); const list=(c.agents&&c.agents.list)||[]; console.log(JSON.stringify(list.filter(a=>/byok|verify/i.test(String(a.id||""))+String(a.name||"")).map(a=>({id:a.id,model:a.model})),null,2));'
