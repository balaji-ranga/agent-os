#!/bin/bash
set -euo pipefail

echo "=== images ==="
docker images 'agent-os-openclaw' --format 'table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}'
echo "=== container state ==="
docker ps -a --filter name=agent-os-openclaw-1 --format '{{.Status}} {{.Image}}'

BASE=agent-os-openclaw:pre-secondary-env-bak
if ! docker image inspect "$BASE" >/dev/null 2>&1; then
  BASE=$(docker images 'agent-os-openclaw' --format '{{.Repository}}:{{.Tag}}' | grep -v secondary-env-fix | head -1)
fi
echo "BASE=$BASE"
test -n "$BASE"
chmod +x /tmp/openclaw-entrypoint.sh

cat > /tmp/Dockerfile.oc-secondary-fix <<EOF
FROM ${BASE}
COPY openclaw-entrypoint.sh /entrypoint.sh
COPY configure-openclaw-docker.js /opt/agent-os/deploy/scripts/configure-openclaw-docker.js
RUN chmod +x /entrypoint.sh && ls -la /entrypoint.sh
EOF

docker build -t agent-os-openclaw:secondary-env-fix -f /tmp/Dockerfile.oc-secondary-fix /tmp
docker tag agent-os-openclaw:secondary-env-fix agent-os-openclaw:latest

# Ensure runtime env + marker still present on volume
docker run --rm -v agent-os_openclaw_home:/root/.openclaw alpine:3.20 sh -c '
  echo "=== volume marker/runtime ==="
  ls -la /root/.openclaw/platform-llm-active.json /root/.openclaw/platform-llm-runtime.env 2>/dev/null || true
  sed -E "s/(KEY=)(.{10}).*/\1\2.../" /root/.openclaw/platform-llm-runtime.env 2>/dev/null || true
  cat /root/.openclaw/platform-llm-active.json 2>/dev/null || true
'

cd /opt/agent-os/deploy
docker compose up -d --no-deps --force-recreate openclaw

for i in $(seq 1 40); do
  if docker exec agent-os-openclaw-1 curl -fsS http://127.0.0.1:18789/ >/dev/null 2>&1; then
    echo "gateway up after ~$((i*2))s"
    break
  fi
  sleep 2
done

echo "=== startup logs ==="
docker logs agent-os-openclaw-1 --tail 80 2>&1 | grep -E 'Honoring|Sourced |providers.openai|secondary|primary=|Starting gateway|WARN|Error|error' || true

echo "=== key check inside running container ==="
docker exec -i agent-os-openclaw-1 python3 - <<'PY'
import json, os
from pathlib import Path
c = json.loads(Path("/root/.openclaw/openclaw.json").read_text())
p = ((c.get("models") or {}).get("providers") or {}).get("openai") or {}
k = str(p.get("apiKey") or "")
ek = os.environ.get("OPENAI_API_KEY", "")
print("providers.openai", (k[:10] + "..." + k[-4:]) if k else "(none)")
print("env OPENAI_API_KEY", (ek[:10] + "..." + ek[-4:]) if ek else "(none)")
print("config_sk_proj", k.startswith("sk-proj"))
print("env_sk_proj", ek.startswith("sk-proj"))
if not ek.startswith("sk-proj"):
    raise SystemExit("FAIL env still not sk-proj")
PY
