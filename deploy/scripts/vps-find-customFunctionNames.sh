#!/bin/bash
set -euo pipefail
scp_done=1
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const glob="/usr/local/lib/node_modules/openclaw/dist";
for (const f of fs.readdirSync(glob)) {
  if (!f.endsWith(".js")) continue;
  const s=fs.readFileSync(glob+"/"+f,"utf8");
  if (!s.includes("customFunctionNames")) continue;
  console.log("FILE", f);
  let i=0,n=0;
  while ((i=s.indexOf("customFunctionNames",i))!==-1 && n<6) {
    console.log(s.slice(Math.max(0,i-120), i+220).replace(/\s+/g," "));
    console.log("---");
    i+=18; n++;
  }
}
'
