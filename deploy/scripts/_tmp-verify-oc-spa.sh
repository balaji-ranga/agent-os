#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
PUBLIC="${AGENT_OS_PUBLIC_URL:-https://flolah.cloud}"
PUBLIC="${PUBLIC%/}"

COOKIE=$(docker compose exec -T backend node -e "
import { createOcConsoleLaunchCookie } from './src/services/openconnector-console-proxy.js';
const c = createOcConsoleLaunchCookie({ id: 'admin', role: 'admin' });
process.stdout.write(c.name + '=' + encodeURIComponent(c.value));
")

HTML=$(curl -ksS "${PUBLIC}/openconnector/" -H "Cookie: ${COOKIE}")
echo "$HTML" | grep -q 'data-oc-path-patch' && echo 'path_patch_OK' || { echo 'FAIL no path patch'; exit 1; }
ASSET=$(echo "$HTML" | grep -oE '/openconnector/assets/index-[^.]+\.js' | head -1)
echo "ASSET=$ASSET"
JS=$(curl -ksS "${PUBLIC}${ASSET}" -H "Cookie: ${COOKIE}")
echo "$JS" | grep -q 'path:`/openconnector/overview`' && echo 'spa_route_OK' || { echo 'FAIL spa route not rewritten'; exit 1; }
echo "$JS" | grep -q '`/openconnector/api/providers`' && echo 'api_path_OK' || echo "$JS" | grep -q '/openconnector/api/providers' && echo 'api_path_OK'
# Must not leave bare overview route
if echo "$JS" | grep -q 'path:`/overview`'; then echo 'FAIL bare /overview still present'; exit 1; fi
CODE=$(curl -ksS -o /tmp/oc-prov.json -w "%{http_code}" "${PUBLIC}/openconnector/api/providers" -H "Cookie: ${COOKIE}")
echo "providers=$CODE"
[[ "$CODE" == "200" ]] || exit 1
echo "OC_SPA_PROXY_OK"
