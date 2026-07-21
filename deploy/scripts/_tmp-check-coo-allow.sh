#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy

echo "=== balserve tools.allow includes agent_workflow_list? ==="
docker compose exec -T openclaw node <<'NODE'
const fs = require('fs');
const c = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json','utf8'));
const agent = (c.agents?.list || []).find(a => String(a.id).toLowerCase() === 'balserve' || String(a.id).toLowerCase() === 'main');
const allow = agent?.tools?.allow || [];
console.log('agent id', agent?.id);
console.log('has agent_workflow_list', allow.includes('agent_workflow_list'));
console.log('workflow tools', allow.filter(t => String(t).includes('workflow')));
const al = '/root/.openclaw/agent-tool-allowlists.json';
if (fs.existsSync(al)) {
  const data = JSON.parse(fs.readFileSync(al,'utf8'));
  for (const key of Object.keys(data)) {
    if (/bala|main|coo|serve/i.test(key)) {
      console.log('allowlist', key, 'workflow?', (data[key]||[]).filter(t => String(t).includes('workflow')));
    }
  }
}
NODE

echo
echo "=== content-tools plugin baseUrl ==="
docker compose exec -T openclaw node -e 'const c=require("/root/.openclaw/openclaw.json"); const p=c.plugins.entries["agent-os-content-tools"]; console.log(JSON.stringify({enabled:p.enabled,baseUrl:p.config?.baseUrl,hasKey:!!p.config?.apiKey},null,2));'
