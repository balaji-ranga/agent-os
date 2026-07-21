#!/bin/bash
set -euo pipefail

DOMAIN=flolah.cloud
WWW=www.flolah.cloud
VPS_IP=76.13.209.30
DEPLOY=/opt/agent-os/deploy
CERT_DIR="${DEPLOY}/nginx/certs"
EMAIL="${LETSENCRYPT_EMAIL:-}"

echo "=== 1) DNS check ==="
resolve() {
  local host="$1"
  getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | head -1 || true
}
A_ROOT=$(resolve "$DOMAIN")
A_WWW=$(resolve "$WWW")
echo "$DOMAIN -> ${A_ROOT:-UNRESOLVED}"
echo "$WWW -> ${A_WWW:-UNRESOLVED}"

if [[ -z "$A_ROOT" ]]; then
  echo "ERROR: $DOMAIN does not resolve. Create an A record to $VPS_IP first."
  exit 1
fi
if [[ "$A_ROOT" != "$VPS_IP" ]]; then
  echo "ERROR: $DOMAIN points to $A_ROOT, expected $VPS_IP"
  exit 1
fi

# www is optional; only include if it points here
DOMAINS=(-d "$DOMAIN")
if [[ -n "$A_WWW" && "$A_WWW" == "$VPS_IP" ]]; then
  DOMAINS+=(-d "$WWW")
  echo "Including www alias"
elif [[ -n "$A_WWW" ]]; then
  echo "WARN: www points to $A_WWW (not $VPS_IP) — skipping www on cert"
else
  echo "WARN: www does not resolve — cert for apex only"
fi

echo
echo "=== 2) Install certbot if needed ==="
if ! command -v certbot >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y certbot
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y certbot
  else
    echo "ERROR: no package manager for certbot"
    exit 1
  fi
fi
certbot --version

echo
echo "=== 3) Stop nginx (free :80 for standalone) ==="
cd "$DEPLOY"
docker compose stop nginx

echo
echo "=== 4) Issue certificate ==="
EMAIL_ARGS=(--register-unsafely-without-email)
if [[ -n "$EMAIL" ]]; then
  EMAIL_ARGS=(-m "$EMAIL" --no-eff-email)
fi

certbot certonly --standalone \
  --non-interactive \
  --agree-tos \
  "${EMAIL_ARGS[@]}" \
  --preferred-challenges http \
  "${DOMAINS[@]}"

LIVE="/etc/letsencrypt/live/${DOMAIN}"
test -f "${LIVE}/fullchain.pem"
test -f "${LIVE}/privkey.pem"

echo
echo "=== 5) Install into nginx/certs ==="
mkdir -p "$CERT_DIR"
cp -f "${LIVE}/fullchain.pem" "${CERT_DIR}/fullchain.pem"
cp -f "${LIVE}/privkey.pem" "${CERT_DIR}/privkey.pem"
chmod 644 "${CERT_DIR}/fullchain.pem"
chmod 600 "${CERT_DIR}/privkey.pem"
ls -la "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/privkey.pem"
openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -subject -issuer -dates

echo
echo "=== 6) Update nginx server_name + .env public URL ==="
NGINX_CONF="${DEPLOY}/nginx/nginx.conf"
if grep -q 'server_name _;' "$NGINX_CONF"; then
  # Replace both HTTP and HTTPS server_name lines
  sed -i "s/server_name _;/server_name ${DOMAIN} ${WWW};/g" "$NGINX_CONF"
  echo "Updated server_name in nginx.conf"
fi
grep -n server_name "$NGINX_CONF"

ENV_FILE="${DEPLOY}/.env"
if grep -q '^AGENT_OS_PUBLIC_URL=' "$ENV_FILE"; then
  sed -i "s|^AGENT_OS_PUBLIC_URL=.*|AGENT_OS_PUBLIC_URL=https://${DOMAIN}|" "$ENV_FILE"
else
  printf '\nAGENT_OS_PUBLIC_URL=https://%s\n' "$DOMAIN" >> "$ENV_FILE"
fi
grep '^AGENT_OS_PUBLIC_URL=' "$ENV_FILE"

echo
echo "=== 7) Start nginx + recreate backend (pick up PUBLIC_URL) ==="
docker compose up -d nginx backend

echo "waiting for nginx..."
sleep 3
docker compose ps nginx backend

echo
echo "=== 8) HTTPS smoke ==="
curl -fsS -o /dev/null -w "https://${DOMAIN}/health -> HTTP %{http_code}\n" "https://${DOMAIN}/health" || \
  curl -kfsS -o /dev/null -w "fallback -k https://127.0.0.1/health -> HTTP %{http_code}\n" "https://127.0.0.1/health" || true

echo
echo "=== 9) Renew deploy hook ==="
HOOK=/etc/letsencrypt/renewal-hooks/deploy/agent-os-nginx.sh
mkdir -p "$(dirname "$HOOK")"
cat > "$HOOK" <<EOF
#!/bin/bash
set -euo pipefail
cp -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ${CERT_DIR}/fullchain.pem
cp -f /etc/letsencrypt/live/${DOMAIN}/privkey.pem ${CERT_DIR}/privkey.pem
chmod 600 ${CERT_DIR}/privkey.pem
cd ${DEPLOY} && docker compose exec -T nginx nginx -s reload || docker compose restart nginx
EOF
chmod +x "$HOOK"
echo "Wrote $HOOK"

echo DONE
