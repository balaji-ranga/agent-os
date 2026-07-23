#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"
PUBLIC="${AGENT_OS_PUBLIC_URL:-https://flolah.cloud}"
PUBLIC="${PUBLIC%/}"

LAUNCH=$(docker compose exec -T backend node -e "
import { createOcConsoleLaunchUrl } from './src/services/openconnector-console-proxy.js';
const l = createOcConsoleLaunchUrl({ id: 'admin', role: 'admin' });
process.stdout.write(JSON.stringify({ url: l.url, cookie: l.cookie.name + '=' + encodeURIComponent(l.cookie.value) }));
")
COOKIE=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["cookie"])' <<<"$LAUNCH")
LAUNCH_URL=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["url"])' <<<"$LAUNCH")

echo "LAUNCH_URL_HOST=$(echo "$LAUNCH_URL" | cut -d/ -f1-3)"

rm -f /tmp/ocjar
# Follow oc_launch redirect and keep cookies
curl -ksS -c /tmp/ocjar -b /tmp/ocjar -L -o /tmp/oc.html -w 'final=%{http_code} url=%{url_effective}\n' "$LAUNCH_URL"
echo "jar:"; cat /tmp/ocjar
echo "html_patch=$(grep -c data-oc-path-patch /tmp/oc.html || true)"
echo "html_base=$(grep -c 'base href=\"/openconnector/' /tmp/oc.html || true)"

ASSET=$(grep -oE '/openconnector/assets/index-[^\"]+\\.js' /tmp/oc.html | head -1)
echo "ASSET=$ASSET"
curl -ksS -b /tmp/ocjar -o /tmp/oc.js "$PUBLIC$ASSET"
echo "bare_overview_path=$(grep -c 'path:\`/overview\`' /tmp/oc.js || true)"
echo "pref_overview_path=$(grep -c 'path:\`/openconnector/overview\`' /tmp/oc.js || true)"
echo "api_pref=$(grep -c '/openconnector/api/providers' /tmp/oc.js || true)"
echo "api_bare=$(grep -c '\`/api/providers\`' /tmp/oc.js || true)"
echo "basename_inj=$(grep -c 'basename:\"/openconnector\"' /tmp/oc.js || true)"
echo "double=$(grep -cE '/openconnector/openconnector/' /tmp/oc.js || true)"

for p in \
  /openconnector/api/providers \
  /openconnector/api/connections \
  /openconnector/api/runtime-tokens \
  /api/connections \
  /overview
do
  code=$(curl -ksS -b /tmp/ocjar -o /tmp/oc-out -w '%{http_code}' "$PUBLIC$p" || echo err)
  echo "GET $p -> $code"
done
