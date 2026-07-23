#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
echo "=== containers ==="
docker ps -a --format '{{.Names}} {{.Status}}' | grep -Ei 'ollama|openclaw|backend' || true
echo "=== env OLLAMA ==="
grep -E '^(OLLAMA_|OPENCLAW_ENABLE|DEEPSEEK_)' .env || true
echo "=== backend OLLAMA_BASE_URL ==="
docker exec agent-os-backend-1 printenv OLLAMA_BASE_URL OLLAMA_MODEL OLLAMA_API_KEY 2>/dev/null || true
echo "=== openclaw OLLAMA ==="
docker exec agent-os-openclaw-1 printenv OLLAMA_BASE_URL OLLAMA_MODEL 2>/dev/null || true
echo "=== ping ollama from backend ==="
docker exec agent-os-backend-1 sh -c 'curl -fsS --max-time 5 http://ollama:11434/api/tags 2>&1 | head -c 300' || echo "BACKEND_OLLAMA_FAIL"
echo "=== ping ollama from openclaw ==="
docker exec agent-os-openclaw-1 sh -c 'curl -fsS --max-time 5 http://ollama:11434/api/tags 2>&1 | head -c 300' || echo "OPENCLAW_OLLAMA_FAIL"
echo "=== byok providers in openclaw.json ==="
docker exec agent-os-openclaw-1 node -e 'const c=require("/root/.openclaw/openclaw.json"); const p=c.models&&c.models.providers||{}; const keys=Object.keys(p).filter(k=>k.startsWith("byok")||k==="ollama"); console.log(JSON.stringify(keys.map(k=>({k, baseUrl:p[k].baseUrl, api:p[k].api, models:(p[k].models||[]).map(m=>m.id||m)})),null,2));'
echo "=== sample ceo llm_provider ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node -e '
import { initDb, getDb } from "./src/db/schema.js";
initDb();
const rows=getDb().prepare("SELECT id, name, llm_provider, CASE WHEN llm_api_key IS NULL OR llm_api_key=\"\" THEN 0 ELSE 1 END AS has_key FROM platform_users WHERE role=\"ceo\" ORDER BY id LIMIT 30").all();
console.log(JSON.stringify(rows,null,2));
'
