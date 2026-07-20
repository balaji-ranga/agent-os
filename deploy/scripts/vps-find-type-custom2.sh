#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const glob="/usr/local/lib/node_modules/openclaw/dist";
const files=fs.readdirSync(glob).filter(f=>f.endsWith(".js"));
let count=0;
for (const f of files) {
  const s=fs.readFileSync(glob+"/"+f,"utf8");
  if (!s.includes("type: \"custom\"") && !s.includes("type:\"custom\"")) continue;
  if (!/tool/i.test(s)) continue;
  const i=s.search(/type:\s*\"custom\"/);
  if (i<0) continue;
  console.log("FILE", f);
  console.log(s.slice(Math.max(0,i-150), i+200).replace(/\s+/g," "));
  console.log("---");
  if (++count>=15) break;
}
console.log("total printed", count);
'
