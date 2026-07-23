#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
echo "==> build+recreate backend (chat path fixes)"
docker compose build backend
docker compose up -d --force-recreate --no-deps backend
sleep 20
docker exec -w /opt/agent-os/backend agent-os-backend-1 node -e 'import("fs").then(fs=>console.log("has_ollama_chat_opts", fs.readFileSync("src/routes/agents.js","utf8").includes("OPENCLAW_OLLAMA_CHAT_TIMEOUT_MS")))'
# Full API path smoke: login as byok verify if we can find password - skip, use internal gateway via backend route simulation
# At least confirm resolveLlmConfig + gateway with stripped instructions via a tiny script
cat > /tmp/api-byok-chat.js <<'JS'
import { initDb, getDb } from './src/db/schema.js';
import { resolveLlmConfigForUser } from './src/services/user-llm-settings.js';
import * as openclaw from './src/gateway/openclaw.js';
import { ensureTenantOpenClawAgent } from './src/services/openclaw-tenant.js';

initDb();
const user = getDb()
  .prepare(`SELECT id FROM platform_users WHERE id = ?`)
  .get('ceo-ceo-byok-verify-mrwstusj-b56255');
if (!user) {
  console.log('NO_USER');
  process.exit(1);
}
const llm = resolveLlmConfigForUser(user.id);
console.log('llm', llm.provider, llm.primary?.model, llm.primary?.baseUrl);
const agent = getDb().prepare(`SELECT * FROM agents WHERE id = 'balserve'`).get();
const ensured = ensureTenantOpenClawAgent(agent, user.id);
const sessionUser = openclaw.sessionUserFor('balserve', user.id, null);
const ctrlTimeout = Number(process.env.OPENCLAW_OLLAMA_CHAT_TIMEOUT_MS || 300000);
const { content } = await openclaw.chatCompletions(
  ensured.openclawAgentId,
  [{ role: 'user', content: 'Hi' }],
  sessionUser,
  false,
  {
    injectLearningsInstruction: false,
    injectSessionHistoryInstruction: false,
    timeoutMs: ctrlTimeout,
  }
);
console.log('reply', String(content).slice(0, 300));
console.log('API_BYOK_CHAT_OK');
JS
docker cp /tmp/api-byok-chat.js agent-os-backend-1:/opt/agent-os/backend/scripts/_tmp-api-byok-chat.js
docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/_tmp-api-byok-chat.js
echo DONE
