#!/bin/bash
cd /opt/agent-os/deploy
docker compose exec -T openclaw sh -c '
  for p in file-transfer llm-task workboard memory-core; do
    echo "==== $p plugin.json ===="
    cat /usr/local/lib/node_modules/openclaw/dist/extensions/$p/openclaw.plugin.json 2>/dev/null | head -60
    echo "==== $p index export head ===="
    head -c 1200 /usr/local/lib/node_modules/openclaw/dist/extensions/$p/index.js 2>/dev/null
    echo
  done
'
