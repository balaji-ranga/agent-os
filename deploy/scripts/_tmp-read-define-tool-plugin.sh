#!/bin/bash
cd /opt/agent-os/deploy
docker compose exec -T openclaw head -n 150 /usr/local/lib/node_modules/openclaw/dist/plugin-sdk/tool-plugin.d.ts
echo '==== example ===='
docker compose exec -T openclaw sh -c '
  f=$(grep -R "defineToolPlugin(" -l /usr/local/lib/node_modules/openclaw/dist/extensions --include="*.js" 2>/dev/null | head -1)
  echo FILE=$f
  grep -n "defineToolPlugin" -A50 "$f" | head -80
'
