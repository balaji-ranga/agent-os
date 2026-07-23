#!/bin/bash
# Deploy platform-LLM hot-reload fix (entrypoint watcher + settings + configure) and
# run 2× Admin primary↔secondary round-trips with Vedic chat probes.
set -euo pipefail

echo "=== deploy files onto host + containers ==="
TS=$(date +%Y%m%d%H%M%S)
cp -a /opt/agent-os/deploy/docker/openclaw-entrypoint.sh "/tmp/openclaw-entrypoint.sh.bak.$TS" 2>/dev/null || true
cp -a /opt/agent-os/deploy/scripts/configure-openclaw-docker.js "/tmp/configure-openclaw-docker.js.bak.$TS" 2>/dev/null || true
cp -a /opt/agent-os/backend/src/services/platform-llm-settings.js "/tmp/platform-llm-settings.js.bak.$TS" 2>/dev/null || true

cp -a /tmp/openclaw-entrypoint.sh /opt/agent-os/deploy/docker/openclaw-entrypoint.sh
cp -a /tmp/configure-openclaw-docker.js /opt/agent-os/deploy/scripts/configure-openclaw-docker.js
cp -a /tmp/platform-llm-settings.js /opt/agent-os/backend/src/services/platform-llm-settings.js
chmod +x /opt/agent-os/deploy/docker/openclaw-entrypoint.sh /tmp/openclaw-entrypoint.sh

docker cp /tmp/platform-llm-settings.js agent-os-backend-1:/opt/agent-os/backend/src/services/platform-llm-settings.js
docker cp /tmp/configure-openclaw-docker.js agent-os-openclaw-1:/opt/agent-os/deploy/scripts/configure-openclaw-docker.js 2>/dev/null || true

# Strip silent ollama from deploy/.env if present (ENABLE=0 should win; also clear explicit list)
if grep -qE '^OPENCLAW_MODEL_FALLBACKS=.*ollama' /opt/agent-os/deploy/.env 2>/dev/null; then
  echo "Clearing OPENCLAW_MODEL_FALLBACKS ollama entries in deploy/.env"
  sed -i -E 's/^OPENCLAW_MODEL_FALLBACKS=.*/OPENCLAW_MODEL_FALLBACKS=/' /opt/agent-os/deploy/.env
fi
grep -qE '^OPENCLAW_ENABLE_OLLAMA_FALLBACK=' /opt/agent-os/deploy/.env \
  && sed -i -E 's/^OPENCLAW_ENABLE_OLLAMA_FALLBACK=.*/OPENCLAW_ENABLE_OLLAMA_FALLBACK=0/' /opt/agent-os/deploy/.env \
  || echo 'OPENCLAW_ENABLE_OLLAMA_FALLBACK=0' >> /opt/agent-os/deploy/.env

echo "=== rebuild openclaw image with new entrypoint ==="
BASE=$(docker inspect agent-os-openclaw-1 --format '{{.Image}}' 2>/dev/null || true)
if [ -z "$BASE" ]; then
  BASE=$(docker images 'agent-os-openclaw' --format '{{.Repository}}:{{.Tag}}' | head -1)
fi
# Prefer tagged image name over digest id for FROM
BASE_NAME=$(docker inspect agent-os-openclaw-1 --format '{{index .Config.Image}}' 2>/dev/null || echo 'agent-os-openclaw:latest')
echo "BASE_NAME=$BASE_NAME BASE_ID=$BASE"

cat > /tmp/Dockerfile.oc-platform-llm-reload <<EOF
FROM ${BASE_NAME}
COPY openclaw-entrypoint.sh /entrypoint.sh
COPY configure-openclaw-docker.js /opt/agent-os/deploy/scripts/configure-openclaw-docker.js
RUN chmod +x /entrypoint.sh
EOF

docker build -t agent-os-openclaw:platform-llm-reload -f /tmp/Dockerfile.oc-platform-llm-reload /tmp
docker tag agent-os-openclaw:platform-llm-reload agent-os-openclaw:latest

echo "=== recreate openclaw + restart backend ==="
cd /opt/agent-os/deploy
docker compose up -d --no-deps --force-recreate openclaw
docker restart agent-os-backend-1

echo "Waiting for openclaw gateway..."
for i in $(seq 1 60); do
  if docker exec agent-os-openclaw-1 curl -fsS http://127.0.0.1:18789/ >/dev/null 2>&1; then
    echo "gateway up after ~$((i*2))s"
    break
  fi
  sleep 2
done

echo "=== startup logs (expect Sourced platform-llm-runtime / Starting gateway) ==="
docker logs agent-os-openclaw-1 --tail 100 2>&1 | grep -E 'Sourced |Honoring|providers.openai|defaults.model|fallbacks|Starting gateway|platform-llm|WARN|Error' || true

echo "=== grep entrypoint for watcher ==="
docker exec agent-os-openclaw-1 grep -c 'run_gateway_with_platform_llm_watch' /entrypoint.sh

echo "DEPLOY_OK"
