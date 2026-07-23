#!/bin/bash
set -euo pipefail

mask() {
  local v="$1"
  if [ -z "$v" ]; then echo "(empty)"; return; fi
  local len=${#v}
  if [ "$len" -le 14 ]; then echo "${v:0:4}..."; return; fi
  echo "${v:0:10}...${v: -4}"
}

echo "=== backend env ==="
docker exec agent-os-backend-1 sh -c '
python3 - <<PY
import os
for v in ["OPENAI_API_KEY","OPENAI_SECONDARY_API_KEY","OPENAI_SECONDARY_MODEL","OPENAI_SECONDARY_BASE_URL","OPENAI_BASE_URL","OPENCLAW_MODEL_PRIMARY"]:
  val=os.environ.get(v,"")
  if not val:
    print(f"{v}=(empty)")
  elif "KEY" in v:
    print(f"{v}={val[:10]}...{val[-4:]} len={len(val)}")
  else:
    print(f"{v}={val}")
PY
'

echo "=== openclaw env ==="
docker exec agent-os-openclaw-1 sh -c '
python3 - <<PY
import os
for v in ["OPENAI_API_KEY","OPENAI_SECONDARY_API_KEY","OPENAI_SECONDARY_MODEL","OPENAI_SECONDARY_BASE_URL","OPENAI_BASE_URL","OPENCLAW_MODEL_PRIMARY"]:
  val=os.environ.get(v,"")
  if not val:
    print(f"{v}=(empty)")
  elif "KEY" in v:
    print(f"{v}={val[:10]}...{val[-4:]} len={len(val)}")
  else:
    print(f"{v}={val}")
PY
'

echo "=== auth profiles / store looking for sk-07 ==="
docker exec agent-os-openclaw-1 sh -c '
python3 - <<PY
import json,os,glob
paths=["/root/.openclaw/openclaw.json"]
paths += glob.glob("/root/.openclaw/**/*.json", recursive=True)
seen=set()
for p in paths:
  if p in seen: continue
  seen.add(p)
  try:
    raw=open(p,"r",encoding="utf-8").read()
  except Exception:
    continue
  if "sk-07" in raw or "apiKey" in raw or "openai" in p.lower():
    # print key-like prefixes only
    import re
    keys=re.findall(r"sk-[A-Za-z0-9_-]{4,}", raw)
    if keys:
      print(p)
      for k in sorted(set(keys)):
        print(" ", k[:10]+"..."+k[-4:], "len", len(k))
PY
'

echo "=== RUN setPlatformLlmActiveEndpoint(secondary) ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module <<'NODE'
import {
  setPlatformLlmActiveEndpoint,
  getPlatformLlmStatusPublic,
} from './src/services/platform-llm-settings.js';
const r = setPlatformLlmActiveEndpoint('secondary');
const k = (r.endpoints && r.endpoints.primary && r.endpoints.primary.apiKey) || '';
console.log(JSON.stringify({
  llm_active_endpoint: r.llm_active_endpoint,
  openclaw: r.openclaw,
  effectivePrimaryKeyPrefix: k ? (k.slice(0,10)+'...'+k.slice(-4)) : '(none)',
  status: getPlatformLlmStatusPublic(),
}, null, 2));
NODE

echo "=== AFTER providers.openai ==="
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const c=JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json","utf8"));
const p=(c.models&&c.models.providers&&c.models.providers.openai)||{};
const k=String(p.apiKey||"");
let marker=null; try{marker=JSON.parse(fs.readFileSync("/root/.openclaw/platform-llm-active.json","utf8"));}catch(e){}
console.log(JSON.stringify({
  defaults:c.agents&&c.agents.defaults&&c.agents.defaults.model,
  openai:{baseUrl:p.baseUrl||null,api:p.api,keyPrefix:k?k.slice(0,10)+"..."+k.slice(-4):"(none)",keyLen:k.length},
  marker
},null,2));
'

echo "=== recent openclaw 401 / fallback logs ==="
docker logs agent-os-openclaw-1 --tail 200 2>&1 | grep -Ei '401|unauthorized|sk-07|fallback|ollama|openai|api\.openai|Invalid' | tail -40 || true
