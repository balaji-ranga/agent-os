#!/usr/bin/env bash
# Expand LE cert to cover login.flolah.cloud and set AGENT_OS_PUBLIC_URL.
#
# Inbound :80 is often blocked on this Hostinger VPS; use acme.sh TLS-ALPN on :443.
# DNS prerequisite: A (and optional AAAA on VPS IPv6) for login.flolah.cloud.
#
# Usage on VPS:
#   bash /opt/agent-os/deploy/scripts/vps-expand-login-cert.sh
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
# shellcheck source=compose-file-defaults.sh
source "$ROOT/deploy/scripts/compose-file-defaults.sh"
export_vps_compose_file "$ROOT/deploy/.env"

LOGIN_HOST="${LOGIN_HOST:-login.flolah.cloud}"
APEX_HOST="${APEX_HOST:-flolah.cloud}"
WWW_HOST="${WWW_HOST:-www.flolah.cloud}"

echo "==> DNS check for ${LOGIN_HOST}"
resolved="$(dig +short "${LOGIN_HOST}" A | head -1 | tr -d '[:space:]')"
if [[ -z "${resolved}" ]]; then
  echo "ERROR: ${LOGIN_HOST} has no A record."
  exit 1
fi
echo "    ${LOGIN_HOST} -> ${resolved}"

if [[ ! -x /root/.acme.sh/acme.sh ]]; then
  echo "==> install acme.sh"
  curl -sS https://get.acme.sh | sh -s email=admin@flolah.cloud
fi

echo "==> stop nginx for TLS-ALPN on :443"
docker compose stop nginx
cleanup() {
  docker compose up -d --no-deps nginx || true
}
trap cleanup EXIT

/root/.acme.sh/acme.sh --set-default-ca --server letsencrypt >/dev/null
/root/.acme.sh/acme.sh --issue -d "${APEX_HOST}" -d "${WWW_HOST}" -d "${LOGIN_HOST}" --alpn --force

echo "==> install cert into deploy/nginx/certs + renew hook"
/root/.acme.sh/acme.sh --install-cert -d "${APEX_HOST}" --ecc \
  --fullchain-file "$ROOT/deploy/nginx/certs/fullchain.pem" \
  --key-file "$ROOT/deploy/nginx/certs/privkey.pem" \
  --reloadcmd "cd $ROOT/deploy && COMPOSE_FILE=$COMPOSE_FILE docker compose exec -T nginx nginx -s reload || docker compose up -d --no-deps nginx"

chmod 644 "$ROOT/deploy/nginx/certs/fullchain.pem"
chmod 600 "$ROOT/deploy/nginx/certs/privkey.pem"
openssl x509 -in "$ROOT/deploy/nginx/certs/fullchain.pem" -noout -text | grep -A3 "Subject Alternative" || true

if grep -q "^AGENT_OS_PUBLIC_URL=" "$ROOT/deploy/.env"; then
  sed -i "s#^AGENT_OS_PUBLIC_URL=.*#AGENT_OS_PUBLIC_URL=https://${LOGIN_HOST}#" "$ROOT/deploy/.env"
else
  echo "AGENT_OS_PUBLIC_URL=https://${LOGIN_HOST}" >> "$ROOT/deploy/.env"
fi

docker compose up -d --force-recreate --no-deps nginx
docker compose up -d --no-deps --force-recreate backend || docker compose restart backend
trap - EXIT

bash "$ROOT/deploy/scripts/assert-vps-ingress.sh"

curl -sS -m 10 -o /dev/null -w "login_home:%{http_code}\n" "https://${LOGIN_HOST}/" || true
echo "Done. App: https://${LOGIN_HOST}"
