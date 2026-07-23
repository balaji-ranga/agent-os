#!/bin/bash
set -euo pipefail
docker exec -w /opt/agent-os/backend agent-os-backend-1 node <<'NODE'
const Module = require('module');
const orig = Module._nodeModulePaths;
Module._nodeModulePaths = function (from) {
  return ['/opt/agent-os/backend/node_modules', '/app/node_modules', ...orig.call(this, from)];
};
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  try {
    Database = require('/opt/agent-os/backend/node_modules/better-sqlite3');
  } catch (e2) {
    Database = require('/app/node_modules/better-sqlite3');
  }
}
const db = new Database('/data/agent-os/agent-os.db', { readonly: true });
console.log('=== window 01:40-02:00 ===');
console.log(JSON.stringify(db.prepare(`SELECT id, tool_name, source, status, created_at, owner_user_id, substr(coalesce(request_payload,''),1,300) req FROM content_tool_logs WHERE created_at >= '2026-07-23 01:40:00' AND created_at <= '2026-07-23 02:00:00' ORDER BY id`).all(), null, 2));
console.log('=== ceo-bala last 20 ===');
console.log(JSON.stringify(db.prepare(`SELECT id, tool_name, status, created_at, owner_user_id FROM content_tool_logs WHERE owner_user_id='ceo-bala' ORDER BY id DESC LIMIT 20`).all(), null, 2));
console.log('=== teamwork in tool logs ===');
console.log(JSON.stringify(db.prepare(`SELECT id, tool_name, status, created_at, owner_user_id, substr(request_payload,1,200) req FROM content_tool_logs WHERE lower(coalesce(request_payload,'')) LIKE '%teamwork%' OR lower(coalesce(response_payload,'')) LIKE '%teamwork%' ORDER BY id DESC LIMIT 10`).all(), null, 2));
console.log('=== teamwork only in chat_turns for ceo-bala ===');
console.log(JSON.stringify(db.prepare(`SELECT id, agent_id, role, created_at, substr(content,1,100) preview FROM chat_turns WHERE owner_user_id='ceo-bala' AND lower(content) LIKE '%teamwork%' ORDER BY id DESC`).all(), null, 2));
NODE

echo "=== which openai key prefix in openclaw env (masked) ==="
docker exec agent-os-openclaw-1 sh -c 'printenv OPENAI_API_KEY OPENAI_SECONDARY_API_KEY 2>/dev/null | sed -E "s/^(.{10}).*(.{4})$/\1…\2/"'
grep -E '^OPENAI_.*API_KEY=|^OPENAI_SECONDARY' /opt/agent-os/deploy/.env | sed -E 's/(KEY=).{10}.*(.{4})$/\1\1…MASKED…\2/; s/(KEY=)(.{8}).*/\1\2…MASKED/'
