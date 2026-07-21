#!/bin/bash
set -euo pipefail
echo "=== plugin manifest ==="
cat /root/.openclaw/extensions/agent-os-content-tools/openclaw.plugin.json
echo
echo "=== tool count / workflow names ==="
python3 - <<'PY'
import json
d=json.load(open('/root/.openclaw/agent-os-tools.json'))
print('count', len(d))
print('workflow', [x.get('name') for x in d if 'workflow' in (x.get('name') or '')])
print('ALL_NAMES=')
print(json.dumps([x['name'] for x in d if x.get('name')]))
PY
echo
echo "=== defineToolPlugin snippet ==="
docker exec agent-os-openclaw-1 node -e 'const fs=require("fs");const s=fs.readFileSync("/usr/local/lib/node_modules/openclaw/dist/tool-plugin-BMP6-oiq.js","utf8");const i=s.indexOf("function defineToolPlugin");console.log(s.slice(i,i+3500));'
echo
echo "=== find definePluginEntry ==="
docker exec agent-os-openclaw-1 sh -c 'grep -l definePluginEntry /usr/local/lib/node_modules/openclaw/dist/extensions/*/index.js 2>/dev/null | head -5'
echo
echo "=== backend invoke test env ==="
docker exec agent-os-backend-1 printenv | grep -E 'TOOLS_BASE_URL|AGENT_OS_PUBLIC_URL|AGENT_OS_INTERNAL|PORT=' || true
