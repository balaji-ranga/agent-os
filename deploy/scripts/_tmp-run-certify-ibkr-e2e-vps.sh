#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
docker cp /opt/agent-os/backend/scripts/test-workflow-certify-ibkr-e2e.js \
  agent-os-backend-1:/opt/agent-os/backend/scripts/test-workflow-certify-ibkr-e2e.js
echo "==> Preflight Balaji + LLM"
docker compose exec -T backend node -e '
import { initDb, getDb } from "./src/db/schema.js";
import { getLlmConfig } from "./src/config/llm.js";
import { getBalaCeoAuthId } from "./src/services/job-applicant-ceo.js";
initDb();
const db = getDb();
const u = db.prepare("SELECT id, name FROM platform_users WHERE name = ?").get("Balaji Ranganathan")
  || db.prepare("SELECT id, name FROM platform_users WHERE id = ?").get("ceo-bala");
const owner = getBalaCeoAuthId();
const c = getLlmConfig(owner);
console.log(JSON.stringify({
  balaji: u,
  owner,
  primary: c.primary?.model,
  hasKey: !!c.primary?.apiKey,
  secondary: c.secondary?.model || null,
  certifyLlmChecker: process.env.WORKFLOW_CERTIFY_USE_LLM_CHECKER || "(unset)",
  openaiBase: (process.env.OPENAI_BASE_URL || "").slice(0, 48),
}, null, 2));
'
echo "==> Certify IBKR-like e2e"
docker compose exec -T -e AGENT_OS_BALA_CEO_ID=ceo-bala backend node scripts/test-workflow-certify-ibkr-e2e.js
