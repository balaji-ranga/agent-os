#!/bin/bash
set -euo pipefail
echo "=== last openclaw errors ==="
docker logs --tail 80 agent-os-openclaw-1 2>&1 | tail -n 80
echo "=== agent models.json files with openai ==="
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const path=require("path");
const root="/root/.openclaw/agents";
for (const d of fs.readdirSync(root)) {
  const mp=path.join(root,d,"agent","models.json");
  if (!fs.existsSync(mp)) continue;
  try {
    const m=JSON.parse(fs.readFileSync(mp,"utf8"));
    const oai=m.providers?.openai || m.openai;
    if (!oai) continue;
    console.log(d, {api:oai.api, baseUrl:oai.baseUrl, model0:(oai.models||[])[0]});
  } catch(e) { console.log(d, e.message); }
}
'
