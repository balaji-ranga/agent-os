#!/usr/bin/env bash
# Ensure OpenClaw HTTP chat API is live after deploy.
# Catches openclaw.json wipes that drop gateway.http.endpoints.chatCompletions
# (symptoms: UI chat 502, gateway body "Not Found" / HTTP 404 on POST /v1/chat/completions).
#
# Usage:
#   bash /opt/agent-os/deploy/scripts/vps-verify-openclaw-chat.sh
# Env:
#   SKIP_OPENCLAW_CHAT_REPAIR=1  - check only
#   OPENCLAW_CHAT_AGENT_ID=...   - override probe agent id
set -euo pipefail

ROOT="${ROOT:-/opt/agent-os}"
cd "$ROOT/deploy" 2>/dev/null || cd "$ROOT"

echo "==> openclaw chatCompletions gate"

if ! docker compose exec -T openclaw true >/dev/null 2>&1; then
  echo "ERROR: openclaw container not running"
  exit 1
fi

# Prefer backend image/host script for latest ensure (shared openclaw_home volume).
run_ensure() {
  if docker compose exec -T backend true >/dev/null 2>&1 \
    && docker compose exec -T backend test -f /opt/agent-os/deploy/scripts/ensure-openclaw-gateway-config.js; then
    docker compose exec -T -w /opt/agent-os backend \
      node deploy/scripts/ensure-openclaw-gateway-config.js 2>&1 || true
    return 0
  fi
  if docker compose exec -T openclaw test -f /opt/agent-os/deploy/scripts/ensure-openclaw-gateway-config.js; then
    docker compose exec -T openclaw \
      node /opt/agent-os/deploy/scripts/ensure-openclaw-gateway-config.js 2>&1 || true
    return 0
  fi
  if [[ -f "$ROOT/deploy/scripts/ensure-openclaw-gateway-config.js" ]]; then
    # Host node optional
    if command -v node >/dev/null 2>&1; then
      OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-}" node "$ROOT/deploy/scripts/ensure-openclaw-gateway-config.js" 2>&1 || true
    fi
  fi
}

if [[ "${SKIP_OPENCLAW_CHAT_REPAIR:-0}" != "1" ]]; then
  if [[ -f "$ROOT/deploy/scripts/ensure-openclaw-gateway-config.js" ]]; then
    sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-openclaw-gateway-config.js" 2>/dev/null || true
    REPAIR=$(run_ensure)
    echo "    ensure: $REPAIR" | head -c 600
    echo
  else
    echo "ERROR: missing ensure-openclaw-gateway-config.js (sync-to-vps incomplete)"
    exit 1
  fi
fi

STRUCT=$(
  docker compose exec -T openclaw node -e '
const fs = require("fs");
const p = process.env.OPENCLAW_CONFIG_PATH || "/root/.openclaw/openclaw.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
const chat = c && c.gateway && c.gateway.http && c.gateway.http.endpoints && c.gateway.http.endpoints.chatCompletions;
const ok = !!(c && c.gateway && c.gateway.mode && chat && chat.enabled === true);
const agent = ((c && c.agents && c.agents.list) || []).map(function (a) { return a.id; }).find(Boolean) || "";
process.stdout.write(JSON.stringify({
  ok: ok,
  keys: Object.keys(c || {}).sort(),
  mode: (c && c.gateway && c.gateway.mode) || null,
  chatCompletions: chat || null,
  hasTools: !!(c && c.tools),
  hasPlugins: !!(c && c.plugins),
  hasBrowser: !!(c && c.browser),
  agentId: agent
}));
' 2>/dev/null || echo '{"ok":false}'
)
echo "    struct: $STRUCT"
if ! echo "$STRUCT" | grep -q '"ok":true' && ! echo "$STRUCT" | grep -q '"ok": true'; then
  echo "ERROR: openclaw.json missing gateway.chatCompletions (keys wiped?)"
  echo "    Fix: bash deploy/scripts/vps-verify-openclaw-chat.sh"
  exit 1
fi

AGENT_ID="${OPENCLAW_CHAT_AGENT_ID:-}"
if [[ -z "$AGENT_ID" ]]; then
  AGENT_ID=$(echo "$STRUCT" | sed -n 's/.*"agentId":"\([^"]*\)".*/\1/p' | head -1)
fi
if [[ -z "$AGENT_ID" ]]; then
  AGENT_ID="main"
fi

probe() {
  docker compose exec -T openclaw sh -c '
TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f /root/.openclaw/openclaw.json ]; then
  TOKEN=$(node -e "try{const c=require(\"/root/.openclaw/openclaw.json\");process.stdout.write((c.gateway&&c.gateway.auth&&c.gateway.auth.token)||\"\")}catch(e){}")
fi
AGENT="'"$AGENT_ID"'"
code=$(curl -sS -o /tmp/oc-chat-body.txt -w "%{http_code}" --max-time 45 \
  -X POST "http://127.0.0.1:${OPENCLAW_GATEWAY_PORT:-18789}/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-openclaw-agent-id: $AGENT" \
  -d "{\"model\":\"openclaw\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"stream\":false}" 2>/dev/null || echo 000)
body=$(head -c 160 /tmp/oc-chat-body.txt 2>/dev/null | tr "\n" " ")
printf "code=%s body=%s\n" "$code" "$body"
' 2>/dev/null || echo "code=000 body=probe_failed"
}

OUT=$(probe)
echo "    probe1: $OUT"
CODE=$(echo "$OUT" | sed -n "s/.*code=\([0-9]*\).*/\1/p" | head -1)

if [[ "$CODE" == "404" ]]; then
  if [[ "${SKIP_OPENCLAW_CHAT_REPAIR:-0}" == "1" ]]; then
    echo "ERROR: /v1/chat/completions returned 404 (endpoint disabled)"
    exit 1
  fi
  echo "    chat 404 - ensure + configure + restart openclaw..."
  run_ensure >/dev/null
  docker compose exec -T openclaw node /opt/agent-os/deploy/scripts/configure-openclaw-docker.js >/dev/null 2>&1 || true
  if docker compose exec -T backend test -f /opt/agent-os/deploy/scripts/configure-openclaw-docker.js 2>/dev/null; then
    docker compose exec -T -w /opt/agent-os backend \
      node deploy/scripts/configure-openclaw-docker.js >/dev/null 2>&1 || true
  fi
  docker compose restart openclaw >/dev/null 2>&1 || true
  for _i in $(seq 1 40); do
    st=$(docker compose ps --format "{{.Health}}" openclaw 2>/dev/null | head -1 || true)
    [[ "$st" == "healthy" ]] && break
    sleep 2
  done
  OUT=$(probe)
  echo "    probe2: $OUT"
  CODE=$(echo "$OUT" | sed -n "s/.*code=\([0-9]*\).*/\1/p" | head -1)
fi

if [[ "$CODE" == "404" || "$CODE" == "000" ]]; then
  echo "ERROR: OpenClaw chat endpoint not usable (http=$CODE)"
  echo "    Expected POST /v1/chat/completions via gateway.http.endpoints.chatCompletions.enabled"
  exit 1
fi

echo "    openclaw chat gate OK (http=$CODE agent=$AGENT_ID)"
exit 0