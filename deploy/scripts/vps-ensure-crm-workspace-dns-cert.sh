#!/bin/bash
# After DNS A for workspace hosts (or *.crm), issue LE SANs and reload nginx.
# Usage: bash /opt/agent-os/deploy/scripts/vps-ensure-crm-workspace-dns-cert.sh
set -uo pipefail
ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
CRM_HOST="${CRM_HOST:-crm.flolah.cloud}"
VPS_IP="${VPS_IP:-76.13.209.30}"
echo "==> CRM workspace DNS readiness (need public A -> ${VPS_IP})"
mapfile -t SUBS < <(docker exec agent-os-twenty-db-1 psql -U twenty -d twenty -t -A -c \
  "SELECT subdomain FROM core.workspace WHERE \"activationStatus\"='ACTIVE' AND \"deletedAt\" IS NULL AND coalesce(subdomain,'')<>''" 2>/dev/null || true)
READY=()
MISSING=()
for sub in "${SUBS[@]}"; do
  sub="$(echo "$sub" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  [[ -z "$sub" ]] && continue
  host="${sub}.${CRM_HOST}"
  # Prefer public resolvers — recursive caches on the VPS often stick on NXDOMAIN after first fail
  ips="$(
    dig @8.8.8.8 +time=3 +tries=1 +short "$host" A 2>/dev/null
    dig @1.1.1.1 +time=3 +tries=1 +short "$host" A 2>/dev/null
  )"
  ips="$(echo "$ips" | grep -E '^[0-9.]+$' | sort -u | tr '\n' ' ' | xargs)"
  if echo " ${ips} " | grep -q " ${VPS_IP} "; then
    echo "  OK   $host -> $ips"
    READY+=("$host")
  else
    echo "  MISS $host -> ${ips:-(NXDOMAIN)}  (add Hostinger A: Name=${sub}.crm Value=${VPS_IP}  OR wildcard Name=*.crm)"
    MISSING+=("$host")
  fi
done
echo
echo "Also check apex ${CRM_HOST}:"
dig @8.8.8.8 +short "${CRM_HOST}" A 2>/dev/null | head -3 || true
echo
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "WARN: ${#MISSING[@]} workspace host(s) not in public DNS yet (skipped for LE SANs)."
  echo "Hostinger DNS (zone flolah.cloud):"
  echo "  Preferred: Type=A  Name=*.crm  Points to=${VPS_IP}  TTL=300"
  echo "  Or per workspace:"
  for h in "${MISSING[@]}"; do
    sub="${h%.${CRM_HOST}}"
    echo "    Type=A  Name=${sub}.crm  Points to=${VPS_IP}"
  done
  echo
fi
if [[ ${#READY[@]} -eq 0 ]]; then
  if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "ERROR: no ACTIVE Twenty workspace hosts resolve to ${VPS_IP} — cannot expand CRM workspace SANs."
    echo "Add DNS (wildcard *.crm or per-sub) then re-run:"
    echo "  bash $ROOT/deploy/scripts/vps-ensure-crm-workspace-dns-cert.sh"
    exit 2
  fi
  echo "ERROR: no Active Twenty workspace subdomains found"
  exit 1
fi
echo "==> Expanding cert SANs for ${#READY[@]} resolvable workspace host(s) (+ platform CRM hosts)"
set -e
bash "$ROOT/deploy/scripts/vps-expand-crm-cert.sh"
echo "==> smoke workspace URLs"
for h in "${READY[@]}"; do
  code=$(curl -sS -m 15 -o /dev/null -w "%{http_code}" "https://${h}/" || echo fail)
  echo "  https://${h}/ -> $code"
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "DONE (with ${#MISSING[@]} workspace(s) still waiting on DNS)"
else
  echo "DONE"
fi
