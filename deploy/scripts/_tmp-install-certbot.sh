#!/bin/bash
set -euo pipefail

echo "=== OS / package options ==="
cat /etc/os-release | head -8
command -v dnf; command -v yum; command -v snap || true

echo
echo "=== try EPEL + certbot ==="
if command -v dnf >/dev/null; then
  dnf install -y epel-release || true
  dnf install -y certbot 2>&1 | tail -20 || true
fi

if command -v certbot >/dev/null; then
  certbot --version
  exit 0
fi

echo
echo "=== try snap ==="
if ! command -v snap >/dev/null; then
  dnf install -y snapd 2>&1 | tail -10 || true
  systemctl enable --now snapd.socket 2>/dev/null || true
  ln -sfn /var/lib/snapd/snap /snap 2>/dev/null || true
  sleep 2
fi
if command -v snap >/dev/null; then
  snap install core 2>&1 | tail -10 || true
  snap refresh core 2>&1 | tail -5 || true
  snap install --classic certbot 2>&1 | tail -15 || true
  ln -sfn /snap/bin/certbot /usr/bin/certbot 2>/dev/null || true
fi

if command -v certbot >/dev/null; then
  certbot --version
  exit 0
fi

echo
echo "=== fallback: certbot via docker ==="
docker pull certbot/certbot:latest
docker run --rm certbot/certbot --version
echo USE_DOCKER_CERTBOT=1
