#!/bin/bash
set -euo pipefail

echo "=== containers ==="
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'backend|openclaw|nginx|frontend' || true

echo "=== hardening markers in backend ==="
docker exec agent-os-backend-1 grep -c allowsInternalQueryToken /opt/agent-os/backend/src/middleware/internal-auth.js
docker exec agent-os-backend-1 grep -c ensureToolsApiKeyConfigured /opt/agent-os/backend/src/config/tools.js
docker exec agent-os-backend-1 test -f /opt/agent-os/backend/src/utils/redact-secrets.js && echo redact_ok
docker exec agent-os-backend-1 grep -c isInternalService /opt/agent-os/backend/src/routes/agents.js

echo "=== nginx log_format ==="
docker exec agent-os-nginx-1 grep -c agent_os_api /etc/nginx/conf.d/default.conf || echo 'nginx missing agent_os_api'

echo "=== primary model ==="
grep -E '^OPENAI_PRIMARY_MODEL=|^OPENCLAW_MODEL_PRIMARY=' /opt/agent-os/deploy/.env
docker exec agent-os-backend-1 printenv OPENAI_PRIMARY_MODEL OPENCLAW_MODEL_PRIMARY

echo "=== health ==="
docker exec agent-os-backend-1 curl -fsS http://127.0.0.1:3001/health
echo

echo "=== re-verify auth hardening ==="
docker exec agent-os-backend-1 node -e '
const tok=process.env.AGENT_OS_INTERNAL_TOKEN;
Promise.all([
  fetch("http://127.0.0.1:3001/api/ibkr-trading/config?internal_token="+encodeURIComponent(tok)).then(r=>["ibkr_query",r.status]),
  fetch("http://127.0.0.1:3001/api/standups/cron-callback?standup_id=1&request_id=x&agent_id=coo&task_id=1&internal_token="+encodeURIComponent(tok),{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(r=>["cron_query",r.status]),
  fetch("http://127.0.0.1:3001/api/ibkr-trading/config",{headers:{"x-agent-os-internal":tok}}).then(r=>["ibkr_header",r.status]),
]).then(rows=>{
  for (const [k,s] of rows) console.log(k,s);
  const ok = rows[0][1]===401 && [200,400,404].includes(rows[1][1]) && rows[2][1]===200;
  process.exit(ok?0:1);
}).catch(e=>{console.error(e); process.exit(1);});
'
echo ALREADY_ON_VPS_OK
