#!/bin/bash
set -euo pipefail

echo "=== backend openclaw paths ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module -e '
import { getOpenClawConfigPath, getOpenClawDir } from "./src/config/openclaw-paths.js";
console.log("dir=", getOpenClawDir());
console.log("cfg=", getOpenClawConfigPath());
' 2>&1 || docker exec agent-os-backend-1 printenv | grep -iE "OPENCLAW|DATA"

echo "=== where are platform-llm files on host/volumes ==="
find /opt/agent-os /var/lib/docker/volumes -name "platform-llm-*" 2>/dev/null | head -40
docker exec agent-os-backend-1 sh -c "find /data /root /opt -name \"platform-llm-*\" 2>/dev/null | head -20"
docker exec agent-os-openclaw-1 sh -c "find /root /home -name \"platform-llm-*\" 2>/dev/null | head -20"

echo "=== backend-visible openclaw.json defaults vs openclaw container ==="
docker exec agent-os-backend-1 sh -c '
for p in /data/agent-os/openclaw.json /root/.openclaw/openclaw.json /opt/agent-os/deploy/openclaw-data/openclaw.json; do
  if [ -f "$p" ]; then
    echo "FOUND $p"
    node -e "const c=require(\"$p\"); console.log(JSON.stringify(c.agents?.defaults?.model,null,2)); const o=c.models?.providers?.openai||{}; console.log(\"baseUrl\",o.baseUrl,\"api\",o.api,\"key\", (o.apiKey||\"\").slice(0,10)+\"...\");"
  fi
done
'

echo "=== does backend module have writePlatformLlmRuntimeEnv? ==="
docker exec agent-os-backend-1 sh -c "grep -n writePlatformLlmRuntimeEnv /opt/agent-os/backend/src/services/platform-llm-settings.js /app/src/services/platform-llm-settings.js 2>/dev/null || true"
grep -n writePlatformLlmRuntimeEnv /opt/agent-os/backend/src/services/platform-llm-settings.js 2>/dev/null || echo "host file missing writePlatform?"

echo "=== runtime.env full redacted + openclaw.json openai from both views ==="
docker exec agent-os-openclaw-1 sh -c "sed -E \"s/(KEY=)(.{10}).*/\1\2...(redacted)/\" /root/.openclaw/platform-llm-runtime.env; echo ---; node -e \"const c=require(\"/root/.openclaw/openclaw.json\"); const o=c.models.providers.openai; console.log(JSON.stringify({primary:c.agents.defaults.model, baseUrl:o.baseUrl, api:o.api, key:(o.apiKey||\"\").slice(0,10)+\"...\"+(o.apiKey||\"\").slice(-4), models:(o.models||[]).map(m=>m.id||m)},null,2));\""

echo "=== gateway PID env via /proc (redacted) ==="
docker exec agent-os-openclaw-1 sh -c '
pid=$(pgrep -n -f "openclaw gateway" || pgrep -n node || true)
echo "pid=$pid"
if [ -n "$pid" ] && [ -r /proc/$pid/environ ]; then
  tr "\0" "\n" < /proc/$pid/environ | grep -E "OPENAI_API_KEY|OPENAI_BASE_URL" | sed -E "s/(KEY=)(.{10}).*/\1\2...(redacted)/"
else
  echo "cannot read process environ"
fi
'

echo "=== simulate what sync would write for primary (dry, no write) ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module -e '
import { getPlatformSetting } from "./src/services/platform-llm-settings.js";
import { getEffectivePlatformLlmEndpoints, getEnvLlmEndpoints } from "./src/services/platform-llm-settings.js";
const active = getPlatformSetting("llm_active_endpoint","primary");
console.log("db active=", active);
const env = getEnvLlmEndpoints();
const redact = (ep)=>({baseUrl:ep?.baseUrl, model:ep?.model, key:(ep?.apiKey||"").slice(0,10)+"..."+(ep?.apiKey||"").slice(-4)});
console.log("env primary", redact(env.primary));
console.log("env secondary", redact(env.secondary));
console.log("effective", JSON.stringify({active: getEffectivePlatformLlmEndpoints().active, primary: redact(getEffectivePlatformLlmEndpoints().primary)}, null, 2));
' 2>&1

echo DONE
