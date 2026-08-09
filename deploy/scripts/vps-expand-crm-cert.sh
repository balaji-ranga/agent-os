#!/usr/bin/env bash
# Expand LE cert SANs to include crm.flolah.cloud + per-workspace {sub}.crm.* SANs (Twenty multi-workspace).
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
# ERP on :443 — Hostinger usually blocks :8444. Prefer erp.crm.<apex> (wildcard *.crm DNS).
ERP_CRM_HOST="${ERP_CRM_HOST:-erp.${CRM_HOST}}"
echo "==> DNS check for ${CRM_HOST}"
resolved="$(dig @8.8.8.8 +short "${CRM_HOST}" A 2>/dev/null | grep -E '^[0-9.]+$' | tail -1 | tr -d '[:space:]')"
if [[ -z "${resolved}" ]]; then
  resolved="$(dig +short "${CRM_HOST}" A 2>/dev/null | grep -E '^[0-9.]+$' | tail -1 | tr -d '[:space:]')"
fi
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
# Multi-workspace: add ACTIVE workspace subdomains as SANs (HTTP-01/ALPN cannot do wildcards).
# Prefer DNS A for each {sub}.crm.<apex> (or wildcard A *.crm) pointing at this VPS.
# Env EXTRA_CRM_SUBDOMAINS="sub1,sub2" or auto-detect from twenty-db when running.
# Use public resolvers — VPS recursive cache often sticks on NXDOMAIN after first fail.
host_has_a() {
  local h="$1"
  dig @8.8.8.8 +time=3 +tries=1 +short "$h" A 2>/dev/null | grep -qE '^[0-9.]+$' \
    || dig @1.1.1.1 +time=3 +tries=1 +short "$h" A 2>/dev/null | grep -qE '^[0-9.]+$'
}
EXTRA_SUBS="${EXTRA_CRM_SUBDOMAINS:-}"
if [[ -z "$EXTRA_SUBS" ]]; then
  EXTRA_SUBS="$(docker exec agent-os-twenty-db-1 psql -U twenty -d twenty -t -A -c \
    "SELECT string_agg(subdomain, ',') FROM core.workspace WHERE \"activationStatus\" = 'ACTIVE' AND \"deletedAt\" IS NULL AND coalesce(subdomain,'') <> ''" 2>/dev/null || true)"
  EXTRA_SUBS="$(echo "$EXTRA_SUBS" | tr -d '[:space:]')"
fi
IFS=',' read -r -a _subs <<< "${EXTRA_SUBS}"
echo "    workspace subs source: ${EXTRA_SUBS:-(none)}"
for raw in "${_subs[@]}"; do
  sub="$(echo "$raw" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
  [[ -z "$sub" ]] && continue
  host="${sub}.${CRM_HOST}"
  if host_has_a "${host}"; then
    DOMS+=(-d "${host}")
    echo "    +SAN ${host}"
  else
    echo "    SKIP SAN ${host} (no A record yet — add DNS A Name=${sub}.crm → VPS or wildcard *.crm)"
  fi
done
if host_has_a "${ERP_CRM_HOST}"; then
  DOMS+=(-d "${ERP_CRM_HOST}")
  echo "    +SAN ${ERP_CRM_HOST} (ERPNext public embed host)"
fi
if host_has_a "${ERP_HOST}"; then
  DOMS+=(-d "${ERP_HOST}")
  echo "    +SAN ${ERP_HOST}"
fi
echo "    domains: ${DOMS[*]}"
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
# ERP embeds use :443 (not :8444 — commonly firewalled)
ERP_PUBLIC="https://${ERP_CRM_HOST}"
if host_has_a "${ERP_HOST}"; then ERP_PUBLIC="https://${ERP_HOST}"; fi
sed -i "s#^ERPNEXT_EMBED_URL=.*#ERPNEXT_EMBED_URL=${ERP_PUBLIC}#" "$ENVF" 2>/dev/null || true
sed -i "s#^ERPNEXT_PUBLIC_URL=.*#ERPNEXT_PUBLIC_URL=${ERP_PUBLIC}#" "$ENVF" 2>/dev/null || true
grep -qE '^ERPNEXT_EMBED_URL=' "$ENVF" || echo "ERPNEXT_EMBED_URL=${ERP_PUBLIC}" >> "$ENVF"
grep -qE '^ERPNEXT_PUBLIC_URL=' "$ENVF" || echo "ERPNEXT_PUBLIC_URL=${ERP_PUBLIC}" >> "$ENVF"
echo "    ERPNEXT public embed: ${ERP_PUBLIC}"
docker compose --env-file .env -f docker-compose.yml -f docker-compose.business-core.yml --profile optional-twenty up -d --force-recreate --no-deps twenty-server twenty-worker || true
docker compose up -d --force-recreate --no-deps nginx backend
trap - EXIT
curl -sS -m 15 -o /dev/null -w "crm:%{http_code}\n" "https://${CRM_HOST}/" || true
curl -sS -m 15 -o /dev/null -w "erp:%{http_code}\n" "${ERP_PUBLIC}/" || true
curl -sS -m 10 -o /dev/null -w "www:%{http_code}\n" "https://${WWW_HOST}/" || true
# smoke one workspace host if any SAN added
for raw in "${_subs[@]}"; do
  sub="$(echo "$raw" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
  [[ -z "$sub" ]] && continue
  host="${sub}.${CRM_HOST}"
  code=$(curl -sS -m 12 -o /dev/null -w "%{http_code}" "https://${host}/" 2>/dev/null || echo fail)
  echo "workspace ${host}: ${code}"
done
echo "Done. CRM https://${CRM_HOST} | Marketing https://${APEX_HOST} + https://${WWW_HOST}"
