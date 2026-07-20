#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/usr/local/lib/node_modules/openclaw/dist/provider-stream-D-7C8M58.js";
const s=fs.readFileSync(p,"utf8");
// find tool projection / convert tools
const keys=["projectTool","type: \"custom\"","custom: {","openai-compat","convertTool","function"];
for (const k of keys) {
  let i=0,n=0;
  while ((i=s.indexOf(k,i))!==-1 && n<4) {
    console.log("\n==",k,"@",i,"==");
    console.log(s.slice(Math.max(0,i-200), i+350).replace(/\s+/g," "));
    i+=k.length; n++;
  }
}
'
