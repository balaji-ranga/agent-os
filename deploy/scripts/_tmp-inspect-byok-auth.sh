#!/bin/bash
set -euo pipefail
AGENT="${1:-t-ceo-byok-ollama-1784764718-35f942--balserve}"
OC=agent-os-openclaw-1

echo "=== mounts ==="
docker inspect "$OC" --format '{{range .Mounts}}{{.Source}} -> {{.Destination}} ({{.Type}}){{println}}{{end}}'

echo "=== all auth-profiles.json ==="
docker exec "$OC" find /root/.openclaw -name auth-profiles.json -print

echo "=== agent dir listing ==="
docker exec "$OC" ls -laR "/root/.openclaw/agents/${AGENT}" 2>/dev/null || echo "NO AGENT DIR"

echo "=== redacted auth-profiles for $AGENT ==="
docker exec -e AGENT="$AGENT" "$OC" node -e '
const fs = require("fs");
const agent = process.env.AGENT;
const p = `/root/.openclaw/agents/${agent}/agent/auth-profiles.json`;
console.log("path=", p, "exists=", fs.existsSync(p));
if (!fs.existsSync(p)) process.exit(0);
const j = JSON.parse(fs.readFileSync(p, "utf8"));
function redact(o, key) {
  if (o == null) return o;
  if (typeof o === "string") {
    if (key && /key|token|secret|password|apiKey|api_key|credential/i.test(String(key)) && o.length > 0) {
      return `${o.slice(0, 4)}…REDACTED…(len=${o.length})`;
    }
    if (o.length > 40) return `${o.slice(0, 6)}…(len=${o.length})`;
    return o;
  }
  if (Array.isArray(o)) return o.map((v) => redact(v));
  if (typeof o === "object") {
    const out = {};
    for (const [k, v] of Object.entries(o)) out[k] = redact(v, k);
    return out;
  }
  return o;
}
console.log(JSON.stringify(redact(j), null, 2));
'

echo "=== comparison: other agents auth-profiles ==="
docker exec "$OC" node -e '
const fs = require("fs");
for (const a of ["balserve", "main", "t-ceo-bala--balserve"]) {
  const p = `/root/.openclaw/agents/${a}/agent/auth-profiles.json`;
  if (!fs.existsSync(p)) { console.log(a, "MISSING"); continue; }
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const keys = j.profiles ? Object.keys(j.profiles) : Object.keys(j);
  console.log(a, "topKeys=", Object.keys(j), "profileIds=", keys.slice(0, 30));
}
'

echo "=== byok provider in openclaw.json ==="
docker exec -e AGENT="$AGENT" "$OC" node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json", "utf8"));
const providers = c.models?.providers || {};
const byok = Object.keys(providers).filter((k) => k.startsWith("byok-"));
console.log("byok provider keys:", byok);
for (const k of byok) {
  const p = { ...providers[k] };
  if (p.apiKey) p.apiKey = String(p.apiKey).slice(0, 4) + "…REDACTED…(len=" + String(p.apiKey).length + ")";
  console.log(k, JSON.stringify(p, null, 2));
}
const agent = process.env.AGENT;
const entry = (c.agents?.list || []).find((e) => e.id === agent);
console.log("agent entry:", JSON.stringify(entry, null, 2));
'

echo "=== CLI help: models auth ==="
docker exec "$OC" openclaw models auth --help 2>&1 || true
echo "=== CLI help: paste-api-key ==="
docker exec "$OC" openclaw models auth paste-api-key --help 2>&1 || true

echo "=== package docs / source search ==="
docker exec "$OC" sh -c '
PKG=/usr/local/lib/node_modules/openclaw
echo "PKG listing:"; ls -la "$PKG" | head -25
echo "--- files matching auth ---"
find "$PKG" -maxdepth 4 \( -iname "*auth*" -o -iname "*paste*" \) 2>/dev/null | head -50
echo "--- ripgrep paste-api-key / auth-profiles ---"
(command -v rg >/dev/null && rg -l -i "auth-profiles|paste-api-key" "$PKG" 2>/dev/null || grep -RIl -E "auth-profiles|paste-api-key" "$PKG" 2>/dev/null) | head -40
'

echo "=== mtime of agent auth files ==="
docker exec "$OC" sh -c "find /root/.openclaw/agents/$AGENT -type f -printf '%T+ %p\n' 2>/dev/null | sort; echo ---; ls -la --time-style=full-iso /root/.openclaw/agents/$AGENT/agent/ 2>/dev/null"
