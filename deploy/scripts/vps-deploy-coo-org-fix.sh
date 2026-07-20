#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy

echo "=== rebuild backend + frontend + openclaw (email_send, notify_ceo, org sync, A2A) ==="
docker compose build backend frontend openclaw
docker compose up -d --force-recreate backend openclaw frontend nginx
sleep 8

echo "=== health ==="
curl -kfsS https://127.0.0.1/api/health
echo

echo "=== verify standups owner column ==="
docker compose exec -T backend node -e "
const { initDb, getDb } = require('./src/db/schema.js');
initDb();
const cols = getDb().prepare('PRAGMA table_info(standups)').all().map(c=>c.name);
console.log('standups columns:', cols.includes('owner_user_id') ? 'owner_user_id OK' : 'MISSING owner_user_id');
"

echo "=== verify org context + full org sync ==="
docker compose exec -T -w /opt/agent-os/backend backend node --input-type=module <<'NODE'
import { initDb } from './src/db/schema.js';
import { syncOrgContextForCeo, buildOrgContextForCeo } from './src/services/org-context.js';
initDb();
const ceo = process.env.AGENT_OS_BALA_CEO_ID || 'ceo-bala';
const n = await syncOrgContextForCeo(ceo);
const ctx = buildOrgContextForCeo(ceo);
console.log('org sync workspaces:', n, 'agents:', ctx.agents.length, 'delegatees:', ctx.delegatees.length);
NODE

echo "=== COO tool grants ==="
docker compose exec -T backend node -e "
import { initDb } from './src/db/schema.js';
import { grantCooDelegationToolsIfMissing, getAgentToolGrants } from './src/services/openclaw-agent-tools.js';
initDb();
const n = grantCooDelegationToolsIfMissing();
const grants = getAgentToolGrants('balserve');
console.log('added', n, 'coo grants', grants.includes('intent_classify_and_delegate') ? 'intent OK' : 'intent MISSING');
console.log('email_send', grants.includes('email_send') ? 'OK' : 'MISSING (boot grantEmailSendToAllAgents?)');
console.log('notify_ceo', grants.includes('notify_ceo') ? 'OK' : 'MISSING (boot grantNotifyCeoToAllAgents?)');
"

if [[ -f /opt/agent-os/deploy/scripts/vps-smoke-new-features.sh ]]; then
  echo "=== email_send + notify_ceo + org sync + A2A smoke ==="
  sed -i 's/\r$//' /opt/agent-os/deploy/scripts/vps-smoke-new-features.sh 2>/dev/null || true
  bash /opt/agent-os/deploy/scripts/vps-smoke-new-features.sh || echo "WARN: smoke failed"
fi

echo DEPLOY_DONE
