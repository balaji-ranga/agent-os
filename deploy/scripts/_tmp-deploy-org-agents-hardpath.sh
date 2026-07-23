#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
docker compose build backend
docker compose up -d --force-recreate --no-deps backend
sleep 18
# quick matcher check inside container
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module -e '
import { tryHandleCooOrgAgentsList } from "./src/services/coo-org-agents-list.js";
const r = tryHandleCooOrgAgentsList("ceo-ceo-byok-verify-mrwstusj-b56255", "what agents are ther ein org?");
console.log(r ? { ok: r.ok, count: r.agent_count, preview: r.cooReply.slice(0,220) } : null);
'
echo ORG_AGENTS_HARDPATH_DEPLOYED
