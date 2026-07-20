#!/bin/bash
set -euo pipefail
OK=$(docker exec agent-os-openclaw-1 printenv OPENROUTER_API_KEY || true)
echo "openrouter key len ${#OK}"
if [ -z "$OK" ]; then
  # try from deploy .env without printing secret
  OK=$(grep -E '^OPENROUTER_API_KEY=' /opt/agent-os/deploy/.env | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
  echo "from deploy.env len ${#OK}"
fi
if [ -z "$OK" ]; then
  echo "No OpenRouter key — cannot switch"
  exit 0
fi
docker exec -e OPENROUTER_API_KEY="$OK" agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const c=JSON.parse(fs.readFileSync(p,"utf8"));
const key=process.env.OPENROUTER_API_KEY;
c.models=c.models||{}; c.models.providers=c.models.providers||{};
c.models.providers.openrouter={
  apiKey:key,
  api:"openai-completions",
  baseUrl:"https://openrouter.ai/api/v1",
  models:[{id:"openai/gpt-4o-mini", name:"openai/gpt-4o-mini", reasoning:false, input:["text"], cost:{input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow:128000, maxTokens:16384}]
};
c.agents.defaults.model.primary="openrouter/openai/gpt-4o-mini";
c.agents.defaults.model.fallbacks=[];
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log("primary", c.agents.defaults.model.primary);
'
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
docker compose restart openclaw
sleep 12
docker exec agent-os-openclaw-1 openclaw agent --agent balserve --message "Reply with exactly PONG. Do not use tools." --json 2>&1 | tail -n 30
docker logs --tail 20 agent-os-openclaw-1 2>&1 | tail -n 20
