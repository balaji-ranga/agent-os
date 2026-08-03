#!/usr/bin/env bash
# Expand the Let's Encrypt cert to include login.flolah.cloud and point AGENT_OS_PUBLIC_URL at it.
#
# Prerequisites (Hostinger DNS / hPanel for flolah.cloud):
#   Create A record:  login  ->  76.13.209.30
#   Wait until: dig +short login.flolah.cloud A  returns the VPS IP
#
# Usage (on VPS):
#   bash /opt/agent-os/deploy/scripts/vps-expand-login-cert.sh
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml:docker-compose.docker-tools.yml}"

LOGIN_HOST="${LOGIN_HOST:-login.flolah.cloud}"
APEX_HOST="${APEX_HOST:-flolah.cloud}"
WWW_HOST="${WWW_HOST:-www.flolah.cloud}"
EXPECTED_IP="${EXPECTED_IP:-76.13.209.30}"

echo "==> DNS check for ${LOGIN_HOST}"
resolved="$(dig +short "${LOGIN_HOST}" A | head -1 | tr -d '[:space:]')"
if [[ -z "${resolved}" ]]; then
  echo "ERROR: ${LOGIN_HOST} has no A record (NXDOMAIN or empty)."
  echo "Add A record: login -> ${EXPECTED_IP} in the flolah.cloud DNS zone, wait for propagation, re-run."
  exit 1
fi
if [[ "${resolved}" != "${EXPECTED_IP}" ]]; then
  echo "WARN: ${LOGIN_HOST} resolves to ${resolved} (expected ${EXPECTED_IP}); continuing."
fi
echo "    ${LOGIN_HOST} -> ${resolved}"

echo "==> stop nginx (standalone HTTP-01 needs :80)"
docker compose stop nginx

cleanup() {
  echo "==> ensure nginx is up"
  docker compose up -d --no-deps nginx || true
}
trap cleanup EXIT

echo "==> expand LE cert for ${LOGIN_HOST}"
certbot certonly --standalone --cert-name flolah.cloud \
  -d "${APEX_HOST}" -d "${WWW_HOST}" -d "${LOGIN_HOST}" \
  --expand --non-interactive --agree-tos --keep-until-expiring

echo "==> install certs into deploy/nginx/certs"
cp -L /etc/letsencrypt/live/flolah.cloud/fullchain.pem "$ROOT/deploy/nginx/certs/fullchain.pem"
cp -L /etc/letsencrypt/live/flolah.cloud/privkey.pem "$ROOT/deploy/nginx/certs/privkey.pem"
chmod 644 "$ROOT/deploy/nginx/certs/fullchain.pem"
chmod 600 "$ROOT/deploy/nginx/certs/privkey.pem"
openssl x509 -in "$ROOT/deploy/nginx/certs/fullchain.pem" -noout -text | grep -A3 'Subject Alternative' || true

echo "==> set AGENT_OS_PUBLIC_URL=https://${LOGIN_HOST}"
if grep -q '^AGENT_OS_PUBLIC_URL=' "$ROOT/deploy/.env"; then
  sed -i "s#^AGENT_OS_PUBLIC_URL=.*#AGENT_OS_PUBLIC_URL=https://${LOGIN_HOST}#" "$ROOT/deploy/.env"
else
  echo "AGENT_OS_PUBLIC_URL=https://${LOGIN_HOST}" >> "$ROOT/deploy/.env"
fi
grep '^AGENT_OS_PUBLIC_URL=' "$ROOT/deploy/.env"

echo "==> recreate nginx + restart backend (new public URL)"
docker compose up -d --force-recreate --no-deps nginx
docker compose up -d --no-deps --force-recreate backend || docker compose restart backend

trap - EXIT

echo "==> smoke"
curl -sk -o /dev/null -w "apex_home:%{http_code}\n" "https://${APEX_HOST}/"
curl -sk -o /dev/null -w "login_home:%{http_code}\n" "https://${LOGIN_HOST}/"
curl -sk -o /dev/null -w "login_api:%{http_code}\n" "https://${LOGIN_HOST}/api/health"
echo "Done. App: https://${LOGIN_HOST}  Marketing: https://${APEX_HOST}"
