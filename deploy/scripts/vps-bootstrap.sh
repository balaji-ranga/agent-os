#!/usr/bin/env bash
# Run on VPS as root after code is at /opt/agent-os
# Usage: bash /opt/agent-os/deploy/scripts/vps-bootstrap.sh
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/agent-os}"
DEPLOY_DIR="${REPO_DIR}/deploy"
PUBLIC_HOST="${PUBLIC_HOST:-76.13.209.30}"

echo "==> OS / resources"
cat /etc/os-release | head -5
free -h | head -2
df -h / | tail -1

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker Engine + Compose plugin"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
    fi
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  elif command -v dnf >/dev/null 2>&1; then
    dnf -y install dnf-plugins-core
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
    dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable --now docker
  else
    echo "Unsupported package manager — install Docker manually" >&2
    exit 1
  fi
  systemctl enable --now docker
fi

docker --version
docker compose version

echo "==> Firewall 80/443"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw allow 22/tcp || true
  ufw --force enable || true
  ufw status || true
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-service=http || true
  firewall-cmd --permanent --add-service=https || true
  firewall-cmd --reload || true
fi

cd "${DEPLOY_DIR}"
if [[ ! -f .env ]]; then
  echo "Missing ${DEPLOY_DIR}/.env — copy from local before continuing" >&2
  exit 1
fi

chmod +x scripts/*.sh ../scripts/setup-openclaw-from-scratch.sh 2>/dev/null || true

if [[ ! -f nginx/certs/fullchain.pem ]]; then
  echo "==> Generating self-signed TLS for ${PUBLIC_HOST}"
  bash scripts/generate-dev-certs.sh "${PUBLIC_HOST}"
fi

echo "==> Ensure deploy secrets"
if command -v node >/dev/null 2>&1; then
  node ../scripts/ensure-deploy-secrets.js --env-file .env || true
fi

echo "==> Build + init + up (with browser overlay for Chromium)"
export COMPOSE_FILE="docker-compose.yml:docker-compose.browser.yml"
docker compose build
docker compose --profile init run --rm init
docker compose up -d

echo "==> Waiting for health"
for i in $(seq 1 60); do
  if curl -kfsS "https://127.0.0.1/api/health" >/dev/null 2>&1 || curl -kfsS "https://${PUBLIC_HOST}/api/health" >/dev/null 2>&1; then
    echo "Healthy"
    break
  fi
  sleep 3
done

docker compose ps
echo "Done bootstrap. Restore data volumes next if not already done."
echo "UI: https://${PUBLIC_HOST}"
