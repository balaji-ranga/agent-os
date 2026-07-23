#!/bin/bash
set -eu
echo "=== gateway process env ==="
docker exec agent-os-openclaw-1 sh -c "ps aux | head -20; echo ----; for p in /proc/[0-9]*; do cmd=\$(tr '\0' ' ' < \$p/cmdline 2>/dev/null || true); echo \"\$cmd\" | grep -q openclaw || continue; echo PID=\${p#/proc/}; tr '\0' '\n' < \$p/environ 2>/dev/null | grep -E '^OPENAI_API_KEY=|^OPENAI_BASE_URL=' | sed -E 's/(KEY=)(.{10}).*/\1\2...(redacted)/'; done"

echo "=== backend running since / sync test write mtime behavior ==="
docker inspect agent-os-backend-1 --format "StartedAt={{.State.StartedAt}}"
docker exec agent-os-backend-1 node -e 'const fs=require("fs"); const p="/root/.openclaw/platform-llm-runtime.env"; const before=fs.statSync(p).mtimeMs; const cur=fs.readFileSync(p,"utf8"); fs.writeFileSync(p,cur); const after=fs.statSync(p).mtimeMs; console.log({before,after,changed:after!==before}); console.log(cur.replace(/(KEY=)(.{10}).*/g,"\$1\$2...(redacted)"));'

echo "=== check if live sync function writes runtime (call sync now while secondary - should refresh mtime) ==="
# DO NOT call sync - diagnose only. Just print function source snippet from RUNNING module if possible
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module -e "import fs from \"fs\"; const s=fs.readFileSync(\"./src/services/platform-llm-settings.js\",\"utf8\"); console.log(\"has writePlatformLlmRuntimeEnv\", s.includes(\"writePlatformLlmRuntimeEnv\")); console.log(\"call site\", /writePlatformLlmRuntimeEnv\\(primary\\)/.test(s));"

echo "=== OPENCLAW_MODEL_PRIMARY mismatch note ==="
grep -E "^OPENCLAW_MODEL_PRIMARY=|^OPENAI_PRIMARY_MODEL=|^OPENAI_BASE_URL=|^OPENCLAW_MODEL_FALLBACKS=|^OPENCLAW_ENABLE_OLLAMA" /opt/agent-os/deploy/.env

echo DONE
