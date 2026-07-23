#!/bin/bash
set -euo pipefail
echo "=== openclaw container env ==="
docker exec agent-os-openclaw-1 sh -c 'echo OPENCLAW_MODEL_PRIMARY=$OPENCLAW_MODEL_PRIMARY; echo OPENAI_BASE_URL=$OPENAI_BASE_URL; echo OPENAI_PRIMARY_MODEL=$OPENAI_PRIMARY_MODEL; echo KEY_LEN=${#OPENAI_API_KEY}'
echo "=== openclaw.json ==="
docker exec agent-os-openclaw-1 node -e 'const c=require("/root/.openclaw/openclaw.json"); const o=(c.models&&c.models.providers&&c.models.providers.openai)||{}; console.log(JSON.stringify({primary:c.agents&&c.agents.defaults&&c.agents.defaults.model&&c.agents.defaults.model.primary,fallbacks:c.agents&&c.agents.defaults&&c.agents.defaults.model&&c.agents.defaults.model.fallbacks,api:o.api,baseUrl:o.baseUrl,models:(o.models||[]).map(m=>m.id||m),hasKey:!!o.apiKey},null,2));'
echo "=== backend container ==="
docker exec agent-os-backend-1 sh -c 'echo OPENAI_BASE_URL=$OPENAI_BASE_URL; echo OPENAI_PRIMARY_MODEL=$OPENAI_PRIMARY_MODEL; echo OPENCLAW_MODEL_PRIMARY=$OPENCLAW_MODEL_PRIMARY; echo KEY_LEN=${#OPENAI_API_KEY}'
python3 /tmp/validate-deepseek-vps.py
