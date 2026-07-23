#!/bin/bash
set -euo pipefail

echo "=== platform_settings ==="
docker exec agent-os-backend-1 node -e 'const Database=require("better-sqlite3"); const db=new Database("/data/agent-os/agent-os.db",{readonly:true}); console.log(JSON.stringify(db.prepare("SELECT key, value, updated_at FROM platform_settings").all(),null,2));'

echo "=== openclaw compose/config env (redacted) ==="
docker inspect agent-os-openclaw-1 --format "{{range .Config.Env}}{{println .}}{{end}}" | grep -E "OPENAI_|OPENCLAW_MODEL|OPENCLAW_ENABLE|OPENCLAW_OLLAMA" | sed -E "s/(KEY=)(.{10}).*/\1\2...(redacted)/"

echo "=== live printenv inside openclaw (redacted) ==="
docker exec agent-os-openclaw-1 printenv | grep -E "OPENAI_|OPENCLAW_MODEL|OPENCLAW_ENABLE|OPENCLAW_OLLAMA" | sed -E "s/(KEY=)(.{10}).*/\1\2...(redacted)/" || true

echo "=== admin route restart? ==="
grep -n "setPlatformLlm\|restart\|openclaw\|docker" /opt/agent-os/backend/src/routes/admin.js | head -30

echo "=== vedic agent entry ==="
docker exec agent-os-openclaw-1 node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json","utf8")); const a=(c.agents?.list||[]).find(x=>String(x.id||"").includes("vedic")); console.log(JSON.stringify({id:a?.id,model:a?.model,name:a?.name},null,2));'

echo "=== openclaw StartedAt ==="
docker inspect agent-os-openclaw-1 --format "StartedAt={{.State.StartedAt}} RestartCount={{.RestartCount}}"
docker exec agent-os-openclaw-1 sh -c "stat -c \"%y %n\" /root/.openclaw/platform-llm-active.json /root/.openclaw/platform-llm-runtime.env; ls -la /root/.openclaw/platform-llm-runtime.env"

echo "=== logs 02:15-02:21 ==="
docker logs agent-os-openclaw-1 --since "2026-07-23T02:15:00" --until "2026-07-23T02:21:00" 2>&1 | grep -iE "Honoring|Sourced|platform-llm|providers.openai|defaults.model|deepseek|401|failover|ollama|configure" | head -80

echo "=== backend container has writePlatformLlmRuntimeEnv? ==="
grep -n "writePlatformLlmRuntimeEnv\|function writePlatform" /opt/agent-os/backend/src/services/platform-llm-settings.js | head -20
docker exec agent-os-backend-1 grep -n "writePlatformLlmRuntimeEnv\|platform-llm-runtime" /opt/agent-os/backend/src/services/platform-llm-settings.js 2>/dev/null | head -20 || docker exec agent-os-backend-1 grep -n "writePlatformLlmRuntimeEnv\|platform-llm-runtime" /app/src/services/platform-llm-settings.js 2>/dev/null | head -20 || echo "grep failed"

echo DONE
