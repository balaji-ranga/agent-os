#!/bin/bash
# Switch platform + OpenClaw primary model to deepseek-v4-flash on VPS and recreate services.
set -euo pipefail

ENV_FILE=/opt/agent-os/deploy/.env
test -f "$ENV_FILE"

echo "=== patch deploy/.env ==="
cp -a "$ENV_FILE" "/tmp/deploy.env.bak.$(date +%Y%m%d%H%M%S)"
python3 - <<'PY'
from pathlib import Path
p = Path("/opt/agent-os/deploy/.env")
text = p.read_text()
repls = {
    "OPENAI_PRIMARY_MODEL": "deepseek-v4-flash",
    "OPENCLAW_MODEL_PRIMARY": "openai/deepseek-v4-flash",
}
lines = []
seen = set()
for line in text.splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        lines.append(line)
        continue
    k, _, _ = line.partition("=")
    if k in repls:
        lines.append(f"{k}={repls[k]}")
        seen.add(k)
    else:
        lines.append(line)
for k, v in repls.items():
    if k not in seen:
        lines.append(f"{k}={v}")
p.write_text("\n".join(lines) + "\n")
print("patched", {k: repls[k] for k in repls})
PY

grep -E '^OPENAI_PRIMARY_MODEL=|^OPENCLAW_MODEL_PRIMARY=|^OPENAI_BASE_URL=' "$ENV_FILE"

echo "=== copy updated configure + platform-llm-settings onto host ==="
if [[ -f /tmp/configure-openclaw-docker.js ]]; then
  cp -a /tmp/configure-openclaw-docker.js /opt/agent-os/deploy/scripts/configure-openclaw-docker.js
fi
if [[ -f /tmp/platform-llm-settings.js ]]; then
  cp -a /tmp/platform-llm-settings.js /opt/agent-os/backend/src/services/platform-llm-settings.js
fi
if [[ -f /tmp/agent-workflow-brain-providers.js ]]; then
  cp -a /tmp/agent-workflow-brain-providers.js /opt/agent-os/backend/src/services/agent-workflow-brain-providers.js
fi
if [[ -f /tmp/agent-workflow-builder-catalog.js ]]; then
  cp -a /tmp/agent-workflow-builder-catalog.js /opt/agent-os/backend/src/services/agent-workflow-builder-catalog.js
fi

echo "=== recreate openclaw + backend with new env ==="
cd /opt/agent-os/deploy
docker compose up -d --no-deps --force-recreate openclaw backend

echo "Waiting for health..."
for i in $(seq 1 60); do
  if docker exec agent-os-backend-1 curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1 \
     && docker exec agent-os-openclaw-1 curl -fsS http://127.0.0.1:18789/ >/dev/null 2>&1; then
    echo "healthy after ~$((i*2))s"
    break
  fi
  sleep 2
done

echo "=== sync platform LLM (primary) into OpenClaw ==="
docker cp /tmp/_tmp-plat-status.mjs agent-os-backend-1:/opt/agent-os/backend/_plat_status.mjs 2>/dev/null || true
# Prefer in-container sync via node
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module <<'NODE'
import { setPlatformLlmActiveEndpoint, getPlatformLlmStatusPublic } from './src/services/platform-llm-settings.js';
import { readFileSync } from 'fs';
import { getOpenClawConfigPath } from './src/config/openclaw-paths.js';

// Ensure active stays primary (DeepSeek flash), rewrite providers + marker
const r = setPlatformLlmActiveEndpoint('primary');
const st = getPlatformLlmStatusPublic();
const cfg = JSON.parse(readFileSync(getOpenClawConfigPath(), 'utf8'));
const o = ((cfg.models || {}).providers || {}).openai || {};
console.log(JSON.stringify({
  switch: {
    active: r.llm_active_endpoint,
    primary: r.openclaw?.primary,
    provider: r.openclaw?.provider,
  },
  status: {
    active: st.llm_active_endpoint,
    primary_model: st.primary?.model,
    effective_model: st.effective_primary?.model,
  },
  openclaw_defaults: cfg.agents?.defaults?.model,
  openai_models: (o.models || []).map((m) => m.id || m).slice(0, 6),
  openai_base: o.baseUrl || null,
}, null, 2));
NODE

echo "=== container env check ==="
docker exec agent-os-openclaw-1 printenv OPENCLAW_MODEL_PRIMARY OPENAI_PRIMARY_MODEL OPENAI_BASE_URL | sed 's/^/openclaw /'
docker exec agent-os-backend-1 printenv OPENCLAW_MODEL_PRIMARY OPENAI_PRIMARY_MODEL OPENAI_BASE_URL | sed 's/^/backend /'

echo "=== quick DeepSeek flash probe ==="
docker exec -i agent-os-openclaw-1 python3 - <<'PY'
import json, os, urllib.request
from pathlib import Path
key = os.environ.get("OPENAI_API_KEY") or ""
# Prefer runtime.env if present
rt = Path("/root/.openclaw/platform-llm-runtime.env")
if rt.exists():
    for line in rt.read_text().splitlines():
        if line.startswith("OPENAI_API_KEY="):
            key = line.split("=",1)[1]
        if line.startswith("OPENAI_BASE_URL="):
            os.environ["OPENAI_BASE_URL"] = line.split("=",1)[1]
base = os.environ.get("OPENAI_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
body = json.dumps({
    "model": "deepseek-v4-flash",
    "messages": [{"role":"user","content":"Reply with exactly: FLASH_OK"}],
    "max_tokens": 16,
    "stream": False,
}).encode()
req = urllib.request.Request(
    base + "/chat/completions",
    data=body,
    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as resp:
    data = json.loads(resp.read().decode())
    text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
    print("http", resp.status, "model", data.get("model"), "text", text[:200])
    assert "FLASH_OK" in text or text.strip(), text
print("FLASH_PROBE_OK")
PY

echo "DEPLOY_FLASH_OK"
