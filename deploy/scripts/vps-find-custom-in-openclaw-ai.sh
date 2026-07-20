#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const path=require("path");
function walk(dir, out=[]) {
  for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=path.join(dir,ent.name);
    if (ent.isDirectory()) walk(p,out);
    else if (ent.name.endsWith(".js") || ent.name.endsWith(".mjs") || ent.name.endsWith(".cjs")) out.push(p);
  }
  return out;
}
const roots=[
  "/usr/local/lib/node_modules/openclaw/node_modules/@openclaw",
  "/usr/local/lib/node_modules/@openclaw",
  "/usr/local/lib/node_modules/openclaw/dist"
].filter(fs.existsSync);
for (const root of roots) {
  console.log("ROOT", root);
  const files=walk(root);
  let hits=0;
  for (const f of files) {
    const s=fs.readFileSync(f,"utf8");
    if (!(s.includes("type: \"custom\"") || s.includes("\"type\":\"custom\""))) continue;
    if (!s.includes("function") || !/tool/i.test(s)) continue;
    if (s.includes("openai-completions") || s.includes("chat.completions") || s.includes("tools.map") || s.includes("customTools")) {
      console.log("HIT", f.replace(root,""));
      const i=s.search(/type:\s*\"custom\"/);
      if (i>=0) console.log(s.slice(Math.max(0,i-100), i+180).replace(/\s+/g," "));
      if (++hits>=8) break;
    }
  }
}
'
