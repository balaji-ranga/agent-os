# Place TLS certificates here for production nginx:
#   fullchain.pem
#   privkey.pem
#
# Production SANs must include:
#   flolah.cloud, www.flolah.cloud, login.flolah.cloud
#
# Inbound TCP :80 is often blocked on Hostinger; certbot HTTP-01 will time out.
# Prefer acme.sh TLS-ALPN on :443 (bundled in vps-expand-login-cert.sh):
#   bash /opt/agent-os/deploy/scripts/vps-expand-login-cert.sh
#
# That script installs renew + nginx reload hooks under /root/.acme.sh/
#
# Dev/staging: run ../scripts/generate-dev-certs.sh
#   (defaults to SANs flolah.cloud, www.flolah.cloud, login.flolah.cloud)
