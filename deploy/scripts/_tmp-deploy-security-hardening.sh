#!/bin/bash
# Deploy security hardening (query-token allowlist, TOOLS_API_KEY fail-closed, from-agent, nginx log redact)
set -euo pipefail

echo "=== copy backend files ==="
docker cp /tmp/internal-auth.js agent-os-backend-1:/opt/agent-os/backend/src/middleware/internal-auth.js
docker cp /tmp/tools.js agent-os-backend-1:/opt/agent-os/backend/src/config/tools.js
docker cp /tmp/agents.js agent-os-backend-1:/opt/agent-os/backend/src/routes/agents.js
docker cp /tmp/index.js agent-os-backend-1:/opt/agent-os/backend/src/index.js
mkdir -p /opt/agent-os/backend/src/middleware /opt/agent-os/backend/src/config /opt/agent-os/backend/src/routes /opt/agent-os/backend/src/utils
cp -a /tmp/internal-auth.js /opt/agent-os/backend/src/middleware/internal-auth.js
cp -a /tmp/tools.js /opt/agent-os/backend/src/config/tools.js
cp -a /tmp/agents.js /opt/agent-os/backend/src/routes/agents.js
cp -a /tmp/index.js /opt/agent-os/backend/src/index.js
cp -a /tmp/redact-secrets.js /opt/agent-os/backend/src/utils/redact-secrets.js
docker exec agent-os-backend-1 mkdir -p /opt/agent-os/backend/src/utils
docker cp /tmp/redact-secrets.js agent-os-backend-1:/opt/agent-os/backend/src/utils/redact-secrets.js

echo "=== nginx ==="
cp -a /tmp/nginx.conf /opt/agent-os/deploy/nginx/nginx.conf
docker exec agent-os-nginx-1 nginx -t
docker exec agent-os-nginx-1 nginx -s reload || docker restart agent-os-nginx-1

echo "=== ensure TOOLS_API_KEY present ==="
if ! grep -qE '^TOOLS_API_KEY=.+' /opt/agent-os/deploy/.env; then
  echo "ERROR: TOOLS_API_KEY missing in deploy/.env — backend will refuse to start in production"
  exit 1
fi
grep -E '^TOOLS_API_KEY=|^AGENT_OS_INTERNAL_TOKEN=' /opt/agent-os/deploy/.env | sed -E 's/=(.{8}).*/=\1…MASKED/'

echo "=== restart backend ==="
docker restart agent-os-backend-1
for i in $(seq 1 40); do
  if docker exec agent-os-backend-1 curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
    echo "backend healthy @$i"
    break
  fi
  sleep 2
done

echo "=== verify hardening ==="
# Load internal token from env file without printing full value
IT=$(grep -E '^AGENT_OS_INTERNAL_TOKEN=' /opt/agent-os/deploy/.env | head -1 | cut -d= -f2-)
# Query token on IBKR must 401
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3001/api/ibkr-trading/config?internal_token=${IT}" || true)
# Reach via docker network
code=$(docker exec agent-os-backend-1 node -e '
const tok=process.env.AGENT_OS_INTERNAL_TOKEN;
fetch("http://127.0.0.1:3001/api/ibkr-trading/config?internal_token="+encodeURIComponent(tok))
  .then(r=>{console.log("ibkr_query_token", r.status); process.exit(r.status===401?0:1);})
  .catch(e=>{console.error(e); process.exit(1);});
')
echo "$code"

docker exec agent-os-backend-1 node -e '
const tok=process.env.AGENT_OS_INTERNAL_TOKEN;
fetch("http://127.0.0.1:3001/api/standups/cron-callback?standup_id=1&request_id=x&agent_id=coo&task_id=1&internal_token="+encodeURIComponent(tok), {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"})
  .then(async r=>{console.log("cron_query_token", r.status, (await r.text()).slice(0,120)); process.exit([200,400,404].includes(r.status)?0:1);})
  .catch(e=>{console.error(e); process.exit(1);});
'

docker exec agent-os-backend-1 node -e '
const tok=process.env.AGENT_OS_INTERNAL_TOKEN;
fetch("http://127.0.0.1:3001/api/ibkr-trading/config", {headers:{"x-agent-os-internal": tok}})
  .then(r=>{console.log("ibkr_header", r.status); process.exit(r.status===200?0:1);})
  .catch(e=>{console.error(e); process.exit(1);});
'

echo "HARDENING_DEPLOY_OK"
