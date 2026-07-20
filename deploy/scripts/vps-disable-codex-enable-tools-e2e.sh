#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml

docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const c=JSON.parse(fs.readFileSync(p,"utf8"));
c.plugins=c.plugins||{};
c.plugins.allow=["agent-os-content-tools","browser","agent-os-bootstrap-watcher"];
c.plugins.entries=c.plugins.entries||{};
c.plugins.entries.codex={enabled:false};
c.plugins.entries["agent-os-content-tools"]={...(c.plugins.entries["agent-os-content-tools"]||{}), enabled:true};
c.plugins.entries.browser={...(c.plugins.entries.browser||{}), enabled:true};
c.plugins.entries["agent-os-bootstrap-watcher"]={...(c.plugins.entries["agent-os-bootstrap-watcher"]||{}), enabled:true};
// Prefer native embedded runner, not codex app-server
if (c.agents?.defaults) {
  delete c.agents.defaults.runtime;
  c.agents.defaults.model=c.agents.defaults.model||{};
  c.agents.defaults.model.primary="openai/gpt-4o-mini";
  c.agents.defaults.model.fallbacks=[];
}
c.models=c.models||{};
c.models.mode="replace";
const existing=c.models.providers?.openai||{};
c.models.providers=c.models.providers||{};
c.models.providers.openai={
  apiKey: existing.apiKey || process.env.OPENAI_API_KEY,
  api: "openai-responses",
  models: (existing.models||[{id:"gpt-4o-mini"},{id:"gpt-4o"}]).map(m=>{
    if (typeof m==="string") return {id:m,name:m,api:"openai-responses"};
    const x={...m,api:"openai-responses"}; delete x.baseUrl; return x;
  })
};
delete c.models.providers.openai.baseUrl;
// Restore balserve tools allowlist
const a=(c.agents.list||[]).find(x=>x.id==="balserve");
if (a) {
  a.tools={
    allow:["summarize_url","generate_image","generate_video","kanban_move_status","kanban_reassign_to_coo","kanban_assign_task","intent_classify_and_delegate","agent_workflow_list","agent_workflow_enquire","agent_workflow_trigger","learnings_summary","ibkr_gateway_ping","ibkr_config","browser","sessions_list","sessions_history","sessions_send"],
    deny:["image"]
  };
}
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log(JSON.stringify({allow:c.plugins.allow, codex:c.plugins.entries.codex, api:c.models.providers.openai.api, primary:c.agents.defaults.model.primary},null,2));
'

docker compose restart openclaw
for i in $(seq 1 25); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then echo ready; break; fi
  echo wait $i; sleep 3
done

echo "=== startup plugins line ==="
docker logs --tail 40 agent-os-openclaw-1 2>&1 | grep -E "plugins:|codex|content-tools|agent model" | tail -n 20

echo "=== probe with tools ==="
set +e
docker exec agent-os-openclaw-1 openclaw agent --agent balserve --message "Reply with exactly PONG. Do not use tools." --json 2>&1 | tail -n 40
set -e

TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
echo "=== summarize_url prompt ==="
docker exec agent-os-openclaw-1 openclaw agent --agent balserve --message 'Use the summarize_url tool now with {"url":"https://example.com"} then confirm the title.' --json 2>&1 | tail -n 50

echo "=== COO tools e2e ==="
docker exec \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -w /opt/agent-os/backend \
  agent-os-backend-1 \
  node scripts/test-coo-tools-prompt-e2e.js
