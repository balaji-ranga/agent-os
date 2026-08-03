# Place TLS certificates here for production nginx:
#   fullchain.pem
#   privkey.pem
#
# Production SANs must include:
#   flolah.cloud, www.flolah.cloud, login.flolah.cloud
#
# Repeatable expand (preferred — stops nginx briefly for standalone HTTP-01):
#   bash /opt/agent-os/deploy/scripts/vps-expand-login-cert.sh
#
# Manual equivalent:
#   docker compose stop nginx
#   certbot certonly --standalone --cert-name flolah.cloud \
#     -d flolah.cloud -d www.flolah.cloud -d login.flolah.cloud --expand --non-interactive
#   cp -L /etc/letsencrypt/live/flolah.cloud/fullchain.pem /opt/agent-os/deploy/nginx/certs/
#   cp -L /etc/letsencrypt/live/flolah.cloud/privkey.pem /opt/agent-os/deploy/nginx/certs/
#   docker compose start nginx
#
# Dev/staging: run ../scripts/generate-dev-certs.sh
#   (defaults to SANs flolah.cloud, www.flolah.cloud, login.flolah.cloud)
