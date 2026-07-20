#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 sh -c 'ls /usr/local/lib/node_modules/openclaw/node_modules/@openclaw/ai/dist | grep -i openai'
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const dir="/usr/local/lib/node_modules/openclaw/node_modules/@openclaw/ai/dist";
for (const f of fs.readdirSync(dir)) {
  if (!/openai/i.test(f) || !f.endsWith(".mjs")) continue;
  const s=fs.readFileSync(dir+"/"+f,"utf8");
  if (!s.includes("custom") || !s.includes("tools")) continue;
  console.log("\n====", f, "len", s.length);
  let i=0,n=0;
  while ((i=s.indexOf("custom", i))!==-1 && n<5) {
    const snip=s.slice(Math.max(0,i-100), i+150);
    if (/tool|type/.test(snip)) { console.log(snip.replace(/\s+/g," ")); console.log("---"); n++; }
    i+=6;
  }
}
'
