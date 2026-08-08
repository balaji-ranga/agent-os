#!/usr/bin/env bash
# Admin / ops: refresh Let's Encrypt TLS certs (acme.sh TLS-ALPN).
# Scopes: all | platform | crm
# Usage: bash /opt/agent-os/deploy/scripts/vps-refresh-tls-certs.sh [all|platform|crm]
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
SCOPE="$(echo "${1:-all}" | tr '[:upper:]' '[:lower:]')"
SCRIPT_DIR="$ROOT/deploy/scripts"

echo "==> TLS cert refresh scope=${SCOPE} root=${ROOT} $(date -Iseconds)"

case "$SCOPE" in
  platform|login|apex)
    bash "$SCRIPT_DIR/vps-expand-login-cert.sh"
    ;;
  crm|workspaces|crmworkspaces)
    bash "$SCRIPT_DIR/vps-ensure-crm-workspace-dns-cert.sh"
    ;;
  all|full)
    if bash "$SCRIPT_DIR/vps-ensure-crm-workspace-dns-cert.sh"; then
      echo "==> full CRM cert path OK"
    else
      echo "==> WARN: CRM workspace path failed — falling back to platform certs only"
      bash "$SCRIPT_DIR/vps-expand-login-cert.sh" || true
      bash "$SCRIPT_DIR/vps-expand-crm-cert.sh" || true
    fi
    ;;
  *)
    echo "ERROR: unknown scope '${SCOPE}'. Use: all | platform | crm"
    exit 1
    ;;
esac

echo "==> current SANs"
openssl x509 -in "$ROOT/deploy/nginx/certs/fullchain.pem" -noout -text 2>/dev/null \
  | grep -A6 "Subject Alternative Name" || true
echo "TLS_REFRESH_DONE scope=${SCOPE}."