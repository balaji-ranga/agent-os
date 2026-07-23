#!/bin/bash
set -euo pipefail

echo "========== 1. platform_settings llm_active_endpoint =========="
docker exec agent-os-backend-1 node -e '
const Database = require("better-sqlite3");
const db = new Database("/data/agent-os/agent-os.db", { readonly: true });
try {
  console.log(JSON.stringify(db.prepare("SELECT key, value, updated_at FROM platform_settings WHERE key LIKE \"%llm%\" OR key LIKE \"%endpoint%\" ORDER BY key").all(), null, 2));
} catch (e) { console.log("err", e.message); }
'

echo "========== 2. getPlatformLlmStatusPublic() =========="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module -e '
import { getPlatformLlmStatusPublic, getPlatformLlmActiveEndpoint, getEffectivePlatformLlmEndpoints } from "./src/services/platform-llm-settings.js";
const pub = getPlatformLlmStatusPublic();
const eff = getEffectivePlatformLlmEndpoints();
const redact = (ep) => ep ? ({ ...ep, apiKey: ep.apiKey ? (ep.apiKey.slice(0,10)+"..."+ep.apiKey.slice(-4)+" len="+ep.apiKey.length) : "(empty)" }) : null;
console.log(JSON.stringify(pub, null, 2));
console.log("active_raw=", getPlatformLlmActiveEndpoint());
console.log("effective_primary=", JSON.stringify(redact(eff.primary), null, 2));
console.log("effective_secondary=", JSON.stringify(redact(eff.secondary), null, 2));
' 2>&1 || docker exec agent-os-backend-1 node --input-type=module -e '
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const candidates = ["/opt/agent-os/backend/src/services/platform-llm-settings.js","/app/src/services/platform-llm-settings.js"];
let m;
for (const p of candidates) { try { m = await import(p); break; } catch(e) { console.error("fail", p, e.message); } }
if (!m) process.exit(1);
console.log(JSON.stringify(m.getPlatformLlmStatusPublic(), null, 2));
'

echo "========== 3. openclaw.json defaults + providers.openai =========="
docker exec agent-os-openclaw-1 node -e '
const fs = require("fs");
const p = process.env.OPENCLAW_CONFIG_PATH || "/root/.openclaw/openclaw.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
const def = c.agents?.defaults?.model || {};
console.log("cfgPath", p);
console.log("agents.defaults.model =", JSON.stringify(def, null, 2));
const o = c.models?.providers?.openai || null;
if (!o) { console.log("providers.openai = MISSING"); }
else {
  const key = o.apiKey || "";
  const prefix = key ? (key.slice(0,10)+"..."+(key.length>14?key.slice(-4):"")+" len="+key.length) : "(empty)";
  const models = (o.models||[]).map(m => typeof m==="string"?m:m.id);
  console.log(JSON.stringify({
    baseUrl: o.baseUrl || "(none)",
    api: o.api || "(none)",
    apiKey_prefix: prefix,
    models
  }, null, 2));
}
const oll = c.models?.providers?.ollama;
if (oll) {
  console.log("providers.ollama =", JSON.stringify({ baseUrl: oll.baseUrl, api: oll.api, models: (oll.models||[]).map(m=>typeof m==="string"?m:m.id).slice(0,5) }, null, 2));
}
const list = Array.isArray(c.agents?.list) ? c.agents.list : [];
const matches = list.filter(a => /vedic|ceo-bala|t-ceo-bala/i.test(String(a.id||a.name||"")));
console.log("vedic agents:", JSON.stringify(matches.map(a => ({ id: a.id, model: a.model })).slice(0,10), null, 2));
'

echo "========== 4. openclaw container env =========="
docker exec agent-os-openclaw-1 python3 - <<'PY'
import os
keys = [
  "OPENAI_API_KEY","OPENAI_BASE_URL","OPENAI_PRIMARY_API_KEY","OPENAI_PRIMARY_BASE_URL","OPENAI_PRIMARY_MODEL",
  "OPENAI_SECONDARY_API_KEY","OPENAI_SECONDARY_BASE_URL","OPENAI_SECONDARY_MODEL",
  "OPENCLAW_MODEL_PRIMARY","OPENCLAW_MODEL_FALLBACKS","OPENCLAW_ENABLE_OLLAMA_FALLBACK","OPENCLAW_OLLAMA_FALLBACK_MODEL",
  "OPENAI_DEFAULT_MODEL"
]
for k in keys:
  v = os.environ.get(k,"")
  if not v:
    print(f"{k}=(empty)")
  elif "KEY" in k:
    pref = v[:10] + "..." + v[-4:] if len(v)>14 else v[:4]+"..."
    print(f"{k}={pref} len={len(v)}")
  else:
    print(f"{k}={v}")
PY

echo "========== 5. platform-llm-active.json + platform-llm-runtime.env =========="
docker exec agent-os-openclaw-1 sh -c '
echo "--- platform-llm-active.json ---"
cat /root/.openclaw/platform-llm-active.json 2>/dev/null || echo "(missing)"
echo
echo "--- platform-llm-runtime.env (redacted) ---"
if [ -f /root/.openclaw/platform-llm-runtime.env ]; then
  sed -E "s/(KEY=)(.{10}).*/\1\2...(redacted)/" /root/.openclaw/platform-llm-runtime.env
else
  echo "(missing)"
fi
'

echo "========== 5b. backend env key prefixes =========="
docker exec agent-os-backend-1 python3 - <<'PY'
import os
for k in ["OPENAI_API_KEY","OPENAI_BASE_URL","OPENAI_PRIMARY_API_KEY","OPENAI_PRIMARY_BASE_URL","OPENAI_PRIMARY_MODEL","OPENAI_SECONDARY_API_KEY","OPENAI_SECONDARY_BASE_URL","OPENAI_SECONDARY_MODEL","OPENCLAW_MODEL_PRIMARY","OPENCLAW_ENABLE_OLLAMA_FALLBACK"]:
  v=os.environ.get(k,"")
  if not v:
    print(f"{k}=(empty)")
  elif "KEY" in k:
    tail = v[-4:] if len(v)>14 else ""
    print(f"{k}={v[:10]}...{tail} len={len(v)}")
  else:
    print(f"{k}={v}")
PY

echo "========== 5c. deploy/.env relevant (redacted) =========="
grep -E "OPENCLAW_MODEL_PRIMARY|OPENAI_PRIMARY|OPENAI_BASE_URL|OPENAI_API_KEY|OPENAI_SECONDARY|OPENCLAW_ENABLE_OLLAMA|OPENCLAW_MODEL_FALLBACKS|OPENCLAW_OLLAMA" /opt/agent-os/deploy/.env 2>/dev/null | sed -E 's/(KEY=)(.{10}).*/\1\2...(redacted)/' || true

echo "========== 6. recent openclaw logs t-ceo-bala / vedic / 401/404 / ollama =========="
docker logs agent-os-openclaw-1 --since 24h 2>&1 | grep -iE "t-ceo-bala|vedic|deepseek|gpt-4o|401|404|failover|ollama|api\.deepseek|notify_ceo|master.?data|platform-llm|Honoring|Sourced platform|No available auth|fallback" | tail -150

echo "========== DONE =========="
