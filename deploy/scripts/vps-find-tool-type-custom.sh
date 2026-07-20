#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const glob="/usr/local/lib/node_modules/openclaw/dist";
const files=fs.readdirSync(glob).filter(f=>f.endsWith(".js"));
for (const f of files) {
  const s=fs.readFileSync(glob+"/"+f,"utf8");
  if (!s.includes("openai-compat") && !s.includes("openai-completions")) continue;
  if (!s.includes("\"custom\"") && !s.includes("type: \"custom\"")) continue;
  // look for tool shaping
  let idx=0, n=0;
  while ((idx=s.indexOf("custom", idx))!==-1 && n<5) {
    const snip=s.slice(Math.max(0,idx-60), idx+80);
    if (/type/.test(snip) && /tool/i.test(snip)) {
      console.log("\nFILE", f, "at", idx);
      console.log(snip.replace(/\s+/g," "));
      n++;
    }
    idx += 6;
  }
}
'
