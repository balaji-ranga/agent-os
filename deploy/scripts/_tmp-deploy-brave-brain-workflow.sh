#!/bin/bash
set -euo pipefail

ENV=/opt/agent-os/deploy/.env
LINE_FILE=/tmp/brave_key_line.env

if [[ ! -f "$LINE_FILE" ]]; then
  echo "ERROR: missing $LINE_FILE"
  exit 1
fi

python3 - <<'PY'
from pathlib import Path
env = Path("/opt/agent-os/deploy/.env")
line = Path("/tmp/brave_key_line.env").read_text().strip()
assert line.startswith("BRAVE_API_KEY="), repr(line[:30])
text = env.read_text()
out = []
found = False
for L in text.splitlines():
    if L.startswith("BRAVE_API_KEY="):
        out.append(line)
        found = True
    else:
        out.append(L)
if not found:
    out.append(line)
env.write_text("\n".join(out) + "\n")
val = line.split("=", 1)[1]
print("BRAVE_KEY_MERGED", "len", len(val), "prefix", val[:4] + "…")
PY
rm -f "$LINE_FILE"

grep -qE '^BRAVE_API_KEY=.+' "$ENV" || { echo "ERROR: BRAVE_API_KEY missing after merge"; exit 1; }

cp -a /tmp/brave-search-mcp.Dockerfile /opt/agent-os/deploy/docker/brave-search-mcp.Dockerfile
cp -a /tmp/docker-compose.yml /opt/agent-os/deploy/docker-compose.yml
cp -a /tmp/seed-brave-search-mcp.js /opt/agent-os/backend/scripts/seed-brave-search-mcp.js
cp -a /tmp/seed-brain-brave-search-workflow.js /opt/agent-os/backend/scripts/seed-brain-brave-search-workflow.js
cp -a /tmp/test-brain-brave-search-workflow.js /opt/agent-os/backend/scripts/test-brain-brave-search-workflow.js

docker cp /tmp/seed-brave-search-mcp.js agent-os-backend-1:/opt/agent-os/backend/scripts/seed-brave-search-mcp.js
docker cp /tmp/seed-brain-brave-search-workflow.js agent-os-backend-1:/opt/agent-os/backend/scripts/seed-brain-brave-search-workflow.js
docker cp /tmp/test-brain-brave-search-workflow.js agent-os-backend-1:/opt/agent-os/backend/scripts/test-brain-brave-search-workflow.js

cd /opt/agent-os/deploy
docker compose --profile optional-brave-mcp up -d --build brave-search-mcp

echo "Waiting for brave MCP container..."
for i in $(seq 1 60); do
  name=$(docker ps --format '{{.Names}}' | grep brave-search-mcp | head -1 || true)
  if [[ -n "$name" ]]; then
    if docker exec "$name" node -e 'fetch("http://127.0.0.1:8080/").then(()=>process.exit(0)).catch(()=>process.exit(1))' 2>/dev/null; then
      echo "mcp http up @$i ($name)"
      break
    fi
  fi
  sleep 3
done

NAME=$(docker ps --format '{{.Names}}' | grep brave-search-mcp | head -1 || true)
echo "=== logs ==="
docker logs "$NAME" --tail 50 2>&1 || true

seed_ok=0
for URL in \
  "http://brave-search-mcp:8080/mcp" \
  "http://brave-search-mcp:8080/" \
  "http://${NAME}:8080/mcp" \
  "http://${NAME}:8080/"; do
  echo "Trying BRAVE_MCP_URL=$URL"
  if docker exec -e BRAVE_MCP_URL="$URL" -w /opt/agent-os/backend agent-os-backend-1 node scripts/seed-brave-search-mcp.js; then
    seed_ok=1
    echo "SEEDED_WITH $URL"
    break
  fi
done
if [[ "$seed_ok" != "1" ]]; then
  echo "MCP seed failed"
  exit 1
fi

docker exec -e BRAIN_BRAVE_TEST_PROVIDER=deepseek -w /opt/agent-os/backend agent-os-backend-1 \
  node scripts/seed-brain-brave-search-workflow.js

docker exec -e BRAIN_BRAVE_TEST_PROVIDER=deepseek -w /opt/agent-os/backend agent-os-backend-1 \
  node scripts/test-brain-brave-search-workflow.js

echo BRAVE_WORKFLOW_DEPLOY_OK
