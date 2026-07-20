#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/usr/local/lib/node_modules/openclaw/dist/openai-transport-stream-B0WkSqXp.js";
const s=fs.readFileSync(p,"utf8");
for (const key of ["openai-responses","openai-completions","openai-compat","custom","tools"]) {
  let i=0,n=0;
  while ((i=s.indexOf(key,i))!==-1 && n<3) {
    console.log("\n==",key,"@",i,"==");
    console.log(s.slice(Math.max(0,i-120), i+200).replace(/\s+/g," "));
    i+=key.length; n++;
  }
}
'
echo "=== ANTHROPIC key in openclaw? ==="
docker exec agent-os-openclaw-1 sh -c 'env | grep -E "^ANTHROPIC" | sed "s/=.*/=***/"'
docker exec agent-os-openclaw-1 node -e 'const c=require("/root/.openclaw/openclaw.json"); console.log("anthropic provider", !!c.models?.providers?.anthropic); console.log("has anthropic key env", !!process.env.ANTHROPIC_API_KEY);'
