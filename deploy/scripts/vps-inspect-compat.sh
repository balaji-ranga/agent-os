#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/usr/local/lib/node_modules/openclaw/dist/openai-completions-compat-D9SGcXbn.js";
console.log(fs.readFileSync(p,"utf8").slice(0,4000));
'
echo "===="
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const glob="/usr/local/lib/node_modules/openclaw/dist";
for (const f of fs.readdirSync(glob)) {
  if (!f.includes("openai") || !f.endsWith(".js")) continue;
  const s=fs.readFileSync(glob+"/"+f,"utf8");
  if (s.includes("detectOpenAICompletionsCompat") || s.includes("forceCompletions") || s.includes("usesCompletions")) {
    console.log("FILE", f);
  }
}
'
# Try disabling content-tools plugin temporarily in memory via config
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const c=JSON.parse(fs.readFileSync(p,"utf8"));
console.log("plugins.allow", c.plugins?.allow);
console.log("entries", Object.keys(c.plugins?.entries||{}));
'
