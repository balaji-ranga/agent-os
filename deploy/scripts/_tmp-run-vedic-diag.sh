#!/bin/bash
set -e
docker cp /tmp/_tmp-diag-vedic-llm.js agent-os-backend-1:/tmp/_tmp-diag-vedic-llm.js
docker cp /tmp/_tmp-diag-vedic-llm.js agent-os-openclaw-1:/tmp/_tmp-diag-vedic-llm.js

echo "===== DB via sqlite3 or node from /opt/agent-os/backend ====="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node /tmp/_tmp-diag-vedic-llm.js db || true

echo "===== OpenClaw config ====="
docker exec agent-os-openclaw-1 node /tmp/_tmp-diag-vedic-llm.js openclaw || true

echo "===== Env both containers ====="
echo "-- backend --"
docker exec agent-os-backend-1 printenv | grep -E 'OPENCLAW_MODEL_PRIMARY|OPENAI_PRIMARY_MODEL|OPENAI_BASE_URL|OPENAI_SECONDARY_MODEL|OPENAI_SECONDARY_BASE' || true
echo "-- openclaw --"
docker exec agent-os-openclaw-1 printenv | grep -E 'OPENCLAW_MODEL_PRIMARY|OPENAI_PRIMARY_MODEL|OPENAI_BASE_URL|OPENAI_SECONDARY_MODEL|OPENAI_SECONDARY_BASE' || true

echo "===== deploy/.env (masked) ====="
grep -E 'OPENCLAW_MODEL_PRIMARY|OPENAI_PRIMARY_MODEL|OPENAI_BASE_URL|OPENAI_SECONDARY_MODEL|OPENAI_SECONDARY_BASE|OPENAI_API_KEY|OPENAI_SECONDARY_API_KEY' /opt/agent-os/deploy/.env | sed -E 's/(KEY=).*/\1***MASKED***/'

echo "===== Recent openclaw logs (vedic/deepseek/gpt) ====="
docker logs agent-os-openclaw-1 --since 12h 2>&1 | grep -iE 'vedic|t-ceo-bala|deepseek|gpt-4o|api\.openai|api\.deepseek|model\.primary|provider' | tail -100 || true
