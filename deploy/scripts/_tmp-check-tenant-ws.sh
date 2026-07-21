#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy

echo "=== openclaw tenants dirs ==="
docker compose exec -T openclaw sh -c '
  ls -la /root/.openclaw/tenants 2>/dev/null | head -40 || echo "NO tenants dir"
  echo ---
  find /root/.openclaw/tenants -maxdepth 2 -type d 2>/dev/null | head -60 || true
'

echo
echo "=== sample tenant agents in openclaw.json ==="
docker compose exec -T openclaw node <<'NODE'
const fs = require('fs');
const c = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json', 'utf8'));
const list = (c.agents && c.agents.list) || [];
const shared = list.filter((a) => !String(a.id).startsWith('t-'));
const tenant = list.filter((a) => String(a.id).startsWith('t-'));
console.log('shared agents', shared.length);
console.log(shared.slice(0, 6).map((a) => ({ id: a.id, workspace: a.workspace })));
console.log('tenant agents', tenant.length);
const balserve = tenant.filter((a) => String(a.id).includes('--balserve'));
console.log('tenant balserve count', balserve.length);
console.log(balserve.slice(0, 8).map((a) => ({ id: a.id, workspace: a.workspace })));
const badWin = tenant.filter((a) => /[A-Za-z]:\\/.test(String(a.workspace || '')) || String(a.workspace || '').includes('/Users/'));
console.log('tenant workspaces with Windows paths', badWin.length);
NODE

echo
echo "=== backend data tenants ==="
docker compose exec -T backend sh -c '
  ls -la /data/agent-os/tenants 2>/dev/null | head -30 || echo "NO data tenants"
'
