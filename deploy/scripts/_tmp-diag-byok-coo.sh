#!/bin/bash
set -euo pipefail
echo "=== find BYOK Verify CEOs ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import { resolveLlmConfigForUser, syncUserLlmToOpenClaw } from './src/services/user-llm-settings.js';
initDb();
const rows = getDb().prepare(
  `SELECT id, name, email, llm_provider FROM platform_users
   WHERE role = 'ceo' AND (name LIKE '%BYOK%' OR name LIKE '%Verify%' OR email LIKE '%byok%' OR llm_provider = 'ollama_free')`
).all();
console.log(JSON.stringify(rows, null, 2));
for (const r of rows.slice(0, 5)) {
  const cfg = resolveLlmConfigForUser(r.id);
  console.log('resolve', r.id, JSON.stringify({ provider: cfg.provider, model: cfg.primary?.model, baseUrl: cfg.primary?.baseUrl, source: cfg.primary?.source }));
}
NODE

echo "=== openclaw ollama provider context ==="
docker exec agent-os-openclaw-1 node -e 'const c=require("/root/.openclaw/openclaw.json"); console.log(JSON.stringify(c.models.providers.ollama,null,2)); const byok=Object.entries(c.models.providers||{}).filter(([k])=>k.includes("verify")); console.log("verify providers", JSON.stringify(byok,null,2)); const agents=(c.agents.list||[]).filter(a=>/verify|byok/i.test(a.id||"")); console.log("agents", JSON.stringify(agents.map(a=>({id:a.id,model:a.model})),null,2));'

echo "=== recent backend errors ==="
docker logs agent-os-backend-1 --tail 80 2>&1 | grep -Ei 'fetch failed|ollama|byok|gateway|ECONN|timeout|error' | tail -40

echo "=== recent openclaw errors ==="
docker logs agent-os-openclaw-1 --tail 80 2>&1 | grep -Ei 'fetch failed|ollama|byok|error|fail|llama' | tail -40
