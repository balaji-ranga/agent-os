#!/bin/bash
set -euo pipefail

show_oc() {
  local label="$1"
  docker exec agent-os-openclaw-1 node -e '
const fs = require("fs");
const label = process.argv[1];
const c = JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json", "utf8"));
const p = (c.models && c.models.providers && c.models.providers.openai) || {};
const k = String(p.apiKey || "");
let marker = null;
try { marker = JSON.parse(fs.readFileSync("/root/.openclaw/platform-llm-active.json", "utf8")); } catch {}
console.log(label, JSON.stringify({
  defaults: c.agents && c.agents.defaults && c.agents.defaults.model,
  openai: {
    baseUrl: p.baseUrl || null,
    api: p.api,
    keyPrefix: k ? (k.slice(0, 10) + "..." + k.slice(-4)) : "(none)",
    keyLen: k.length,
    models: (p.models || []).map((m) => m.id || m).slice(0, 8),
  },
  marker,
}, null, 2));
' "$label"
}

echo "=== BEFORE ==="
show_oc BEFORE

echo "=== backend env prefixes ==="
docker exec agent-os-backend-1 sh -c '
for v in OPENAI_API_KEY OPENAI_SECONDARY_API_KEY OPENAI_SECONDARY_MODEL OPENAI_SECONDARY_BASE_URL OPENAI_BASE_URL; do
  val=$(printenv "$v" || true)
  if [ -z "$val" ]; then echo "$v=(empty)"; continue; fi
  case "$v" in
    *KEY*) echo "$v=${val:0:10}...${val: -4}" ;;
    *) echo "$v=$val" ;;
  esac
done
'

echo "=== openclaw env prefixes ==="
docker exec agent-os-openclaw-1 sh -c '
for v in OPENAI_API_KEY OPENAI_SECONDARY_API_KEY OPENAI_SECONDARY_MODEL OPENAI_SECONDARY_BASE_URL OPENAI_BASE_URL OPENCLAW_MODEL_PRIMARY; do
  val=$(printenv "$v" || true)
  if [ -z "$val" ]; then echo "$v=(empty)"; continue; fi
  case "$v" in
    *KEY*) echo "$v=${val:0:10}...${val: -4}" ;;
    *) echo "$v=$val" ;;
  esac
done
'

echo "=== RUN setPlatformLlmActiveEndpoint(secondary) ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module <<'NODE'
import {
  setPlatformLlmActiveEndpoint,
  getPlatformLlmStatusPublic,
} from './src/services/platform-llm-settings.js';
const r = setPlatformLlmActiveEndpoint('secondary');
console.log(JSON.stringify({
  llm_active_endpoint: r.llm_active_endpoint,
  openclaw: r.openclaw,
  status: getPlatformLlmStatusPublic(),
}, null, 2));
NODE

echo "=== AFTER sync ==="
sleep 1
show_oc AFTER_SYNC

# Restart OpenClaw so gateway reloads config; configure-openclaw-docker should honor marker
echo "=== restart openclaw (honor platform-llm-active marker) ==="
cd /opt/agent-os/deploy
docker compose restart openclaw
# wait healthy-ish
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if docker exec agent-os-openclaw-1 node -e 'process.exit(0)' 2>/dev/null; then
    break
  fi
  sleep 2
done
sleep 3
show_oc AFTER_RESTART

echo "=== configure-openclaw-docker recent logs (marker honor?) ==="
docker logs agent-os-openclaw-1 --tail 80 2>&1 | grep -E 'Honoring platform-llm|providers.openai|OPENAI_API_KEY|secondary|primary=' || true

echo "=== quick OpenAI responses probe with providers.openai.apiKey ==="
docker exec agent-os-openclaw-1 node -e '
const fs = require("fs");
const https = require("https");
const c = JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json", "utf8"));
const p = (c.models && c.models.providers && c.models.providers.openai) || {};
const key = String(p.apiKey || "");
console.log("probe keyPrefix", key ? key.slice(0,10)+"..."+key.slice(-4) : "(none)");
if (!key.startsWith("sk-proj")) {
  console.error("FAIL: expected sk-proj key, got", key.slice(0,10));
  process.exit(2);
}
const body = JSON.stringify({
  model: "gpt-4o-mini",
  input: "Reply with exactly: OK_SECONDARY",
  max_output_tokens: 32,
});
const req = https.request({
  hostname: "api.openai.com",
  path: "/v1/responses",
  method: "POST",
  headers: {
    "Authorization": "Bearer " + key,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  },
}, (res) => {
  let data = "";
  res.on("data", (d) => data += d);
  res.on("end", () => {
    console.log("status", res.statusCode);
    const snippet = data.slice(0, 500);
    console.log(snippet);
    if (res.statusCode >= 200 && res.statusCode < 300) process.exit(0);
    process.exit(1);
  });
});
req.on("error", (e) => { console.error(e); process.exit(1); });
req.write(body);
req.end();
'

echo "=== DONE core fix ==="
