#!/bin/bash
cd /opt/agent-os/deploy
docker compose exec -T openclaw sh -c '
  grep -R "non-capability\|defineToolPlugin\|registerTool" -n /usr/local/lib/node_modules/openclaw/dist/plugin-sdk* 2>/dev/null | head -20
  ls /usr/local/lib/node_modules/openclaw/dist/plugin-sdk* 2>/dev/null | head
  ls /usr/local/lib/node_modules/openclaw/package.json
  node -e "const p=require(\"/usr/local/lib/node_modules/openclaw/package.json\"); console.log(Object.keys(p.exports||{}).slice(0,40))"
'
