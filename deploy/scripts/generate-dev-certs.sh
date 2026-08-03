#!/usr/bin/env bash
# Generate self-signed TLS certs for nginx (dev / staging only).
# Usage:
#   ./generate-dev-certs.sh
#   ./generate-dev-certs.sh flolah.cloud
#   ./generate-dev-certs.sh flolah.cloud www.flolah.cloud login.flolah.cloud
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../nginx/certs" && pwd)"
mkdir -p "${DIR}"

if [[ $# -eq 0 ]]; then
  set -- flolah.cloud www.flolah.cloud login.flolah.cloud
fi

CN="$1"
shift || true
SAN="DNS:${CN}"
for h in "$@"; do
  SAN="${SAN},DNS:${h}"
done

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "${DIR}/privkey.pem" \
  -out "${DIR}/fullchain.pem" \
  -subj "/CN=${CN}" \
  -addext "subjectAltName=${SAN}"

echo "Wrote ${DIR}/fullchain.pem and ${DIR}/privkey.pem (CN=${CN}; SAN=${SAN})"
