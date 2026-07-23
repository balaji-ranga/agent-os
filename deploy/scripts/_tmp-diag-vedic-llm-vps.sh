#!/bin/bash
set -euo pipefail

echo "========== 1. platform_users Balaji =========="
docker exec agent-os-backend-1 node -e '
const Database = require("better-sqlite3");
const db = new Database("/data/agent-os/agent-os.db", { readonly: true });
const cols = db.prepare("PRAGMA table_info(platform_users)").all().map(c => c.name);
console.log("cols:", cols.join(", "));
const hasUsername = cols.includes("username");
const hasTenant = cols.includes("tenant_id");
const q = `
SELECT id,
       coalesce(email,"") as email,
       coalesce(name,"") as name,
       ${hasUsername ? 'coalesce(username,"") as username,' : ""}
       ${hasTenant ? 'coalesce(tenant_id,"") as tenant_id,' : ""}
       coalesce(llm_provider,"") as llm_provider,
       CASE WHEN llm_api_key IS NOT NULL AND length(trim(llm_api_key)) > 0 THEN 1 ELSE 0 END as llm_api_key_set,
       CASE WHEN llm_api_key IS NOT NULL AND length(trim(llm_api_key)) > 8
         THEN substr(llm_api_key,1,4) || "..." || substr(llm_api_key,-4)
         ELSE CASE WHEN llm_api_key IS NOT NULL AND length(trim(llm_api_key))>0 THEN "(short)" ELSE "" END END as key_masked
FROM platform_users
WHERE lower(coalesce(name,"")) LIKE "%balaji%"
   OR lower(coalesce(email,"")) LIKE "%balaji%"
   OR lower(coalesce(name,"")) LIKE "%ranganathan%"
   OR id LIKE "%bala%"
   OR id LIKE "%ceo-bala%"
`;
console.log(JSON.stringify(db.prepare(q).all(), null, 2));
console.log("========== 2. platform_settings llm* ==========");
try {
  console.log(JSON.stringify(db.prepare("SELECT key, value, updated_at FROM platform_settings WHERE key LIKE \"%llm%\" OR key LIKE \"%endpoint%\"").all(), null, 2));
} catch (e) { console.log("err", e.message); }
'

echo "========== 3. getPlatformLlmStatusPublic =========="
docker exec agent-os-backend-1 node --input-type=module -e '
import { getPlatformLlmStatusPublic, getPlatformLlmActiveEndpoint, syncPlatformEndpointToOpenClaw } from "./src/services/platform-llm-settings.js";
console.log(JSON.stringify(getPlatformLlmStatusPublic(), null, 2));
console.log("active_endpoint_raw=", getPlatformLlmActiveEndpoint());
' 2>/dev/null || docker exec -w /app agent-os-backend-1 node --input-type=module -e '
import { createRequire } from "module";
const require = createRequire(import.meta.url);
async function main() {
  const candidates = [
    "/app/src/services/platform-llm-settings.js",
    "/opt/agent-os/backend/src/services/platform-llm-settings.js",
  ];
  let m;
  for (const p of candidates) {
    try { m = await import(p); break; } catch {}
  }
  if (!m) { console.error("cannot import platform-llm-settings"); process.exit(1); }
  console.log(JSON.stringify(m.getPlatformLlmStatusPublic(), null, 2));
}
main();
'

echo "========== 4. openclaw.json excerpt =========="
CFG_HOST=""
for p in /root/.openclaw/openclaw.json /opt/agent-os/deploy/openclaw-data/openclaw.json /var/lib/docker/volumes/*openclaw*/_data/openclaw.json; do
  if [ -f "$p" ]; then CFG_HOST="$p"; break; fi
done
echo "host_cfg_candidate=$CFG_HOST"
docker exec agent-os-openclaw-1 sh -c 'ls -la /root/.openclaw/openclaw.json 2>/dev/null; ls -la /home/node/.openclaw/openclaw.json 2>/dev/null; printenv OPENCLAW_CONFIG_PATH OPENCLAW_MODEL_PRIMARY OPENAI_BASE_URL OPENAI_PRIMARY_MODEL OPENAI_SECONDARY_MODEL 2>/dev/null'

docker exec agent-os-openclaw-1 node -e '
const fs = require("fs");
const paths = [
  process.env.OPENCLAW_CONFIG_PATH,
  "/root/.openclaw/openclaw.json",
  "/home/node/.openclaw/openclaw.json",
].filter(Boolean);
let cfgPath = paths.find(p => fs.existsSync(p));
if (!cfgPath) { console.log("NO CONFIG"); process.exit(1); }
console.log("cfgPath", cfgPath);
const c = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const def = c.agents?.defaults?.model || {};
console.log("agents.defaults.model =", JSON.stringify(def, null, 2));
const list = Array.isArray(c.agents?.list) ? c.agents.list : [];
const matches = list.filter(a => {
  const id = String(a.id || a.name || "");
  return /vedic|ceo-bala/i.test(id);
});
console.log("matching agents count", matches.length);
for (const a of matches) {
  console.log(JSON.stringify({ id: a.id, name: a.name, model: a.model }, null, 2));
}
const providers = Object.keys(c.models?.providers || {});
console.log("models.providers keys:", providers.join(", "));
for (const k of providers) {
  const p = c.models.providers[k];
  const models = (p.models || []).map(m => (typeof m === "string" ? m : m.id)).slice(0, 8);
  console.log("  provider", k, "baseUrl=", p.baseUrl || "(none)", "api=", p.api || "", "models=", models.join(","));
}
'

echo "========== 5. recent openclaw logs vedic/deepseek/gpt-4o =========="
docker logs agent-os-openclaw-1 --since 6h 2>&1 | grep -iE "vedic|ceo-bala|deepseek|gpt-4o|openai|model|provider|api\.openai|api\.deepseek" | tail -80

echo "========== 6. env overwrite check =========="
echo "--- backend ---"
docker exec agent-os-backend-1 sh -c 'echo OPENCLAW_MODEL_PRIMARY=$OPENCLAW_MODEL_PRIMARY; echo OPENAI_PRIMARY_MODEL=$OPENAI_PRIMARY_MODEL; echo OPENAI_BASE_URL=$OPENAI_BASE_URL; echo OPENAI_SECONDARY_MODEL=$OPENAI_SECONDARY_MODEL'
echo "--- openclaw ---"
docker exec agent-os-openclaw-1 sh -c 'echo OPENCLAW_MODEL_PRIMARY=$OPENCLAW_MODEL_PRIMARY; echo OPENAI_PRIMARY_MODEL=$OPENAI_PRIMARY_MODEL; echo OPENAI_BASE_URL=$OPENAI_BASE_URL; echo OPENAI_SECONDARY_MODEL=$OPENAI_SECONDARY_MODEL'
echo "--- compose deploy/.env grep ---"
grep -E "OPENCLAW_MODEL_PRIMARY|OPENAI_PRIMARY_MODEL|OPENAI_BASE_URL|OPENAI_SECONDARY" /opt/agent-os/deploy/.env | sed "s/\(KEY=\).*/\1***MASKED***/"
