#!/bin/bash
cd /opt/agent-os/deploy
docker compose exec -T openclaw sh <<'EOF'
set -e
EXT=/usr/local/lib/node_modules/openclaw/dist/extensions
echo "=== stock extensions ==="
ls "$EXT" | head -40
echo
echo "=== find plugin json with tools capability ==="
grep -R '"tools"' -l "$EXT"/*/openclaw.plugin.json 2>/dev/null | head -15
echo
echo "=== sample plugin json (first with tools) ==="
f=$(grep -R '"tools"' -l "$EXT"/*/openclaw.plugin.json 2>/dev/null | head -1)
echo FILE=$f
head -120 "$f"
echo
echo "=== content-tools diagnostics ==="
openclaw plugins doctor agent-os-content-tools 2>&1 | head -80
echo
echo "=== why index.ts preferred ==="
openclaw plugins info agent-os-content-tools 2>&1 | head -40
EOF
