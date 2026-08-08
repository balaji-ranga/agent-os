#!/usr/bin/env bash
# Expand LE cert SANs to include crm.flolah.cloud (Twenty CRM public host).
# DNS prerequisite: A or CNAME for crm.flolah.cloud → this VPS.
# Usage: bash /opt/agent-os/deploy/scripts/vps-expand-crm-cert.sh
set -euo pipefail
ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml:docker-compose.docker-tools.yml}"
LOGIN_HOST="${LOGIN_HOST:-login.flolah.cloud}"
APEX_HOST="${APEX_HOST:-flolah.cloud}"
WWW_HOST="${WWW_HOST:-www.flolah.cloud}"
CRM_HOST="${CRM_HOST:-crm.flolah.cloud}"
ERP_HOST="${ERP_HOST:-erp.flolah.cloud}"
echo "==> DNS check for ${CRM_HOST}"
resolved="$(dig +short "${CRM_HOST}" A | grep -E '^[0-9.]+$' | tail -1 | tr -d '[:space:]')"
if [[ -z "${resolved}" ]]; then
  echo "ERROR: ${CRM_HOST} has no A record yet."
  echo "  Hostinger DNS: Type=A Name=crm Value=76.13.209.30 (or CNAME crm → ${APEX_HOST})"
  exit 1
fi
echo "    ${CRM_HOST} -> ${resolved}"
if [[ ! -x /root/.acme.sh/acme.sh ]]; then
  curl -sS https://get.acme.sh | sh -s email=admin@flolah.cloud
fi
echo "==> stop nginx for TLS-ALPN on :443"
docker compose stop nginx
cleanup() { docker compose up -d --no-deps nginx || true; }
trap cleanup EXIT
/root/.acme.sh/acme.sh --set-default-ca --server letsencrypt >/dev/null
DOMS=(-d "${APEX_HOST}" -d "${WWW_HOST}" -d "${LOGIN_HOST}" -d "${CRM_HOST}")
if dig +short "${ERP_HOST}" A | grep -qE '^[0-9.]+$'; then DOMS+=(-d "${ERP_HOST}"); fi
/root/.acme.sh/acme.sh --issue "${DOMS[@]}" --alpn --force
/root/.acme.sh/acme.sh --install-cert -d "${APEX_HOST}" --ecc \
  --fullchain-file "$ROOT/deploy/nginx/certs/fullchain.pem" \
  --key-file "$ROOT/deploy/nginx/certs/privkey.pem" \
  --reloadcmd "cd $ROOT/deploy && COMPOSE_FILE=$COMPOSE_FILE docker compose exec -T nginx nginx -s reload || docker compose up -d --no-deps nginx"
chmod 644 "$ROOT/deploy/nginx/certs/fullchain.pem"
chmod 600 "$ROOT/deploy/nginx/certs/privkey.pem"
openssl x509 -in "$ROOT/deploy/nginx/certs/fullchain.pem" -noout -text | grep -A6 "Subject Alternative" || true
ENVF="$ROOT/deploy/.env"
sed -i "s#^TWENTY_SERVER_URL=.*#TWENTY_SERVER_URL=https://${CRM_HOST}#" "$ENVF" || echo "TWENTY_SERVER_URL=https://${CRM_HOST}" >> "$ENVF"
sed -i "s#^TWENTY_EMBED_URL=.*#TWENTY_EMBED_URL=https://${CRM_HOST}#" "$ENVF" || echo "TWENTY_EMBED_URL=https://${CRM_HOST}" >> "$ENVF"
# ensure lines exist if sed no-op on missing
grep -qE '^TWENTY_SERVER_URL=' "$ENVF" || echo "TWENTY_SERVER_URL=https://${CRM_HOST}" >> "$ENVF"
grep -qE '^TWENTY_EMBED_URL=' "$ENVF" || echo "TWENTY_EMBED_URL=https://${CRM_HOST}" >> "$ENVF"
docker compose --env-file .env -f docker-compose.yml -f docker-compose.business-core.yml --profile optional-twenty up -d --force-recreate --no-deps twenty-server twenty-worker || true
docker compose up -d --force-recreate --no-deps nginx backend
trap - EXIT
curl -sS -m 15 -o /dev/null -w "crm:%{http_code}\n" "https://${CRM_HOST}/" || true
curl -sS -m 10 -o /dev/null -w "www:%{http_code}\n" "https://${WWW_HOST}/" || true
echo "Done. CRM https://${CRM_HOST} | Marketing https://${APEX_HOST} + https://${WWW_HOST}"
