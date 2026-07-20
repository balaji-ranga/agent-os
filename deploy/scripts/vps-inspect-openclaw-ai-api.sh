#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const path=require("path");
function walk(dir, out=[]) {
  for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=path.join(dir,ent.name);
    if (ent.isDirectory()) {
      if (ent.name==="node_modules" || ent.name===".git") continue;
      walk(p,out);
    } else if (/\.(js|mjs|cjs|ts)$/.test(ent.name)) out.push(p);
  }
  return out;
}
const root="/usr/local/lib/node_modules/openclaw/node_modules/@openclaw/ai";
const files=walk(root);
console.log("files", files.length);
let n=0;
for (const f of files) {
  const s=fs.readFileSync(f,"utf8");
  if (!s.includes("openai-responses") && !s.includes("openai-completions")) continue;
  if (!s.includes("custom") || !/tool/i.test(s)) continue;
  console.log("\nFILE", f.replace(root,""));
  const i=s.indexOf("openai-responses");
  if (i>=0) console.log("responses context:", s.slice(Math.max(0,i-80), i+120).replace(/\s+/g," "));
  const j=s.search(/type:\s*[\"']custom[\"']/);
  if (j>=0) console.log("custom context:", s.slice(Math.max(0,j-80), j+120).replace(/\s+/g," "));
  if (++n>=12) break;
}
'
