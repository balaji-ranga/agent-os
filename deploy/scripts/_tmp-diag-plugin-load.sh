#!/bin/bash
cd /opt/agent-os/deploy
echo "=== full plugin startup ==="
docker compose logs --since=3m openclaw 2>/dev/null | grep -iE 'plugin|extension|content-tools|bootstrap|load|error|warn' | tail -50

echo
echo "=== openclaw plugins doctor ==="
docker compose exec -T openclaw sh -c 'openclaw plugins list 2>&1 | head -60; openclaw plugins info agent-os-content-tools 2>&1 | head -40'

echo
echo "=== package.json / type module? ==="
docker compose exec -T openclaw sh -c '
  for d in /root/.openclaw/extensions/agent-os-content-tools /root/.openclaw/extensions/agent-os-bootstrap-watcher; do
    echo DIR $d; ls -la $d; cat $d/package.json 2>/dev/null || echo no package.json
  done
'

echo
echo "=== try importing plugin in node ==="
docker compose exec -T openclaw node --input-type=module -e '
import("/root/.openclaw/extensions/agent-os-content-tools/index.js").then(m=>console.log("ok", Object.keys(m))).catch(e=>console.error("import fail", e))
'
