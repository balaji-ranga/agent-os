#!/usr/bin/env bash
# Smoke: platform Meta Graph MCP container + registry seed (no Facebook credentials required).
set -euo pipefail
ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"

echo "==> ensure meta-graph-mcp is up"
docker compose --env-file .env --profile optional-meta-graph-mcp up -d --build meta-graph-mcp
for i in $(seq 1 30); do
  if docker compose --env-file .env exec -T meta-graph-mcp \
    node -e "fetch('http://127.0.0.1:8081/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "    meta-graph-mcp healthy"
    break
  fi
  sleep 2
done

echo "==> seed platform mcp-meta-graph"
docker compose --env-file .env exec -T backend node scripts/seed-meta-graph-mcp.js

echo "==> verify registry row (platform owner_user_id empty)"
docker compose --env-file .env exec -T backend node --input-type=module - <<'NODE'
import { initDb, getDb } from "./src/db/schema.js";
initDb();
const s = getDb().prepare("SELECT id, is_platform, owner_role, status FROM mcp_servers WHERE id=?").get("mcp-meta-graph");
const c = getDb()
  .prepare("SELECT provider, enabled, owner_user_id FROM mcp_oauth_configs WHERE server_id=? AND owner_user_id=?")
  .get("mcp-meta-graph", "");
if (!s || !s.is_platform || s.owner_role !== "admin") throw new Error("mcp-meta-graph not platform: " + JSON.stringify(s));
if (!c || !c.enabled) throw new Error("oauth platform config missing: " + JSON.stringify(c));
console.log("registry_ok", s, c);
NODE

echo "VPS_META_GRAPH_MCP_SMOKE_OK"
