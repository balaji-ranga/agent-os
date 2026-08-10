#!/usr/bin/env bash
# Fail-closed VPS ingress checks. Never treat "container healthy" alone as OK when
# host-network nginx is the public edge (that regression made all logins 502 while
# docker compose exec backend curl 127.0.0.1:3001 still passed).
#
# Usage (on VPS from deploy/ or via absolute path):
#   bash deploy/scripts/assert-vps-ingress.sh
#   PUBLIC_URL=https://login.flolah.cloud bash deploy/scripts/assert-vps-ingress.sh
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
DEPLOY="${ROOT}/deploy"
cd "$DEPLOY"

BACKEND_C="${BACKEND_CONTAINER:-agent-os-backend-1}"
FRONTEND_C="${FRONTEND_CONTAINER:-agent-os-frontend-1}"
NGINX_C="${NGINX_CONTAINER:-agent-os-nginx-1}"

PUBLIC_URL="${PUBLIC_URL:-${AGENT_OS_PUBLIC_URL:-}}"
if [[ -z "$PUBLIC_URL" && -f "$DEPLOY/.env" ]]; then
  PUBLIC_URL="$(grep -E '^AGENT_OS_PUBLIC_URL=' "$DEPLOY/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)"
fi
PUBLIC_URL="${PUBLIC_URL:-https://login.flolah.cloud}"

fail() {
  echo "ERROR: assert-vps-ingress: $*" >&2
  exit 1
}

ok() {
  echo "    OK: $*"
}

echo "==> assert-vps-ingress PUBLIC_URL=$PUBLIC_URL"

if ! docker inspect "$BACKEND_C" >/dev/null 2>&1; then
  fail "backend container $BACKEND_C not found"
fi

BE_PORTS="$(docker port "$BACKEND_C" 2>/dev/null || true)"
echo "$BE_PORTS" | grep -qE '3001/tcp -> 127\.0\.0\.1:3001' \
  || fail "backend is not published on 127.0.0.1:3001 (docker port shows: ${BE_PORTS//$'\n'/; }). Recreate with COMPOSE_FILE including vps-client-ip (or base compose loopback ports)."
ok "backend docker port 127.0.0.1:3001"

if ! curl -fsS -m 5 "http://127.0.0.1:3001/health" >/dev/null; then
  fail "curl http://127.0.0.1:3001/health failed (host cannot reach published backend)"
fi
ok "host loopback GET /health"

NGINX_MODE=""
if docker inspect "$NGINX_C" >/dev/null 2>&1; then
  NGINX_MODE="$(docker inspect "$NGINX_C" --format '{{.HostConfig.NetworkMode}}' 2>/dev/null || true)"
fi

if [[ "$NGINX_MODE" == "host" ]]; then
  ok "nginx network_mode=host"
  FE_PORTS="$(docker port "$FRONTEND_C" 2>/dev/null || true)"
  echo "$FE_PORTS" | grep -qE '80/tcp -> 127\.0\.0\.1:8080' \
    || fail "frontend not published on 127.0.0.1:8080 (got: ${FE_PORTS//$'\n'/; }) - host nginx needs it"
  ok "frontend docker port 127.0.0.1:8080"
  if ! curl -fsS -m 5 -o /dev/null "http://127.0.0.1:8080/" 2>/dev/null; then
    if ! timeout 2 bash -c "echo >/dev/tcp/127.0.0.1/8080" 2>/dev/null; then
      fail "nothing listening on 127.0.0.1:8080"
    fi
  fi
  ok "host loopback frontend :8080 reachable"
else
  echo "    note: nginx NetworkMode=${NGINX_MODE:-unknown} (bridge). Skipped host-only SPA check."
fi

code="$(curl -skS -m 10 -o /tmp/assert-vps-health.json -w "%{http_code}" "${PUBLIC_URL%/}/api/health" || echo 000)"
if [[ "$code" != "200" ]]; then
  body="$(head -c 200 /tmp/assert-vps-health.json 2>/dev/null || true)"
  fail "GET ${PUBLIC_URL%/}/api/health -> HTTP $code body=${body}"
fi
if ! grep -q '"status":"ok"' /tmp/assert-vps-health.json 2>/dev/null; then
  fail "public /api/health body not ok: $(head -c 200 /tmp/assert-vps-health.json)"
fi
ok "public GET /api/health 200"

login_code="$(curl -skS -m 10 -o /tmp/assert-vps-login.json -w "%{http_code}" \
  -X POST "${PUBLIC_URL%/}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"assert-vps-ingress@invalid.example","password":"x"}' || echo 000)"
if [[ "$login_code" == "502" || "$login_code" == "504" || "$login_code" == "000" ]]; then
  fail "POST /api/auth/login -> HTTP $login_code (edge cannot reach backend)"
fi
if grep -qi "Bad Gateway" /tmp/assert-vps-login.json 2>/dev/null; then
  fail "login returned Bad Gateway HTML"
fi
ok "public POST /api/auth/login HTTP $login_code (not 502)"

echo "==> assert-vps-ingress PASS"