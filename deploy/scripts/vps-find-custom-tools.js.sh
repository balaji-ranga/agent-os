#!/bin/bash
set -euo pipefail
# Find how OpenClaw decides openai-compat vs responses and custom tools
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const glob="/usr/local/lib/node_modules/openclaw/dist";
const files=fs.readdirSync(glob).filter(f=>f.endsWith(".js"));
let hits=[];
for (const f of files) {
  const s=fs.readFileSync(glob+"/"+f,"utf8");
  if (s.includes("openai-compat") && s.includes("openai-responses")) hits.push(f);
}
console.log("files", hits.slice(0,20));
'
docker exec agent-os-openclaw-1 sh -c 'grep -l "Invalid value" /usr/local/lib/node_modules/openclaw/dist/*.js 2>/dev/null | head'
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const glob="/usr/local/lib/node_modules/openclaw/dist";
for (const f of fs.readdirSync(glob)) {
  if (!f.endsWith(".js")) continue;
  const s=fs.readFileSync(glob+"/"+f,"utf8");
  if (!s.includes("type:\"custom\"") && !s.includes("type: \"custom\"") && !s.includes("\"custom\"")) continue;
  if (s.includes("tools") && (s.includes("custom") || s.includes("function"))) {
    const i=s.indexOf("custom");
    if (i>=0 && s.slice(Math.max(0,i-80), i+80).includes("type")) {
      console.log("HIT", f, s.slice(Math.max(0,i-100), i+120).replace(/\n/g," "));
    }
  }
}
' 2>/dev/null | head -n 30
