#!/usr/bin/env bash
set -euo pipefail
docker exec -i agent-os-nginx-1 sh -c 'cat > /etc/nginx/nginx.conf' <<'EOF'
user  nginx;
worker_processes  auto;

error_log  /var/log/nginx/error.log notice;
pid        /var/run/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  /var/log/nginx/access.log  main;

    sendfile        on;
    keepalive_timeout  65;

    include /etc/nginx/conf.d/*.conf;
}
EOF
docker exec agent-os-nginx-1 nginx -t
docker exec agent-os-nginx-1 nginx -s reload
echo "nginx_main_restored"
bash /opt/agent-os/deploy/scripts/_tmp-verify-oc-spa.sh
