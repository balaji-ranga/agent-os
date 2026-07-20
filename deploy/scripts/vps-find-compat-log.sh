#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 sh -c 'find /usr/local/lib/node_modules -maxdepth 4 -type d -name "pi-ai" 2>/dev/null; find /usr/local/lib/node_modules -maxdepth 5 -type d -name "ai" 2>/dev/null | head'
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const path=require("path");
const nm="/usr/local/lib/node_modules/openclaw/node_modules";
if (!fs.existsSync(nm)) { console.log("no nested nm"); process.exit(0);} 
console.log(fs.readdirSync(nm).slice(0,40));
'
# Why is api openai-responses ignored? Dump model via openclaw models json
docker exec agent-os-openclaw-1 openclaw models list --json 2>/dev/null | head -c 2000 || true
echo
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
// search for "openai-compat: chat completion"
const glob="/usr/local/lib/node_modules/openclaw/dist";
for (const f of fs.readdirSync(glob)) {
  if (!f.endsWith(".js")) continue;
  const s=fs.readFileSync(glob+"/"+f,"utf8");
  if (s.includes("openai-compat: chat completion")) {
    console.log("LOGFILE", f);
    const i=s.indexOf("openai-compat: chat completion");
    console.log(s.slice(Math.max(0,i-500), i+300).replace(/\s+/g," "));
  }
}
'
