#!/usr/bin/env bash
# Verify OC console subpath hosting: basename injection + API prefix (no SPA route rewrite).
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"
PUBLIC="${AGENT_OS_PUBLIC_URL:-https://flolah.cloud}"
PUBLIC="${PUBLIC%/}"

COOKIE=$(docker compose exec -T backend node -e "
import { createOcConsoleLaunchCookie } from './src/services/openconnector-console-proxy.js';
const c = createOcConsoleLaunchCookie({ id: 'admin', role: 'admin' });
process.stdout.write(c.name + '=' + encodeURIComponent(c.value));
")

HTML=$(curl -ksS "${PUBLIC}/openconnector/" -H "Cookie: ${COOKIE}")
echo "$HTML" | grep -q 'data-oc-path-patch' && echo 'path_patch_OK' || { echo 'FAIL no path patch'; exit 1; }
echo "$HTML" | grep -q 'base href="/openconnector/' && echo 'base_OK' || { echo 'FAIL no base href'; exit 1; }

ASSET=$(echo "$HTML" | grep -oE '/openconnector/assets/index-[^"]+\.js' | head -1)
echo "ASSET=$ASSET"
JS=$(curl -ksS "${PUBLIC}${ASSET}" -H "Cookie: ${COOKIE}")

echo "$JS" | grep -q 'basename:"/openconnector"' && echo 'basename_OK' || { echo 'FAIL BrowserRouter basename not injected'; exit 1; }
echo "$JS" | grep -q 'path:`/overview`' && echo 'spa_route_bare_OK' || { echo 'FAIL expected bare path:`/overview`'; exit 1; }
if echo "$JS" | grep -q 'path:`/openconnector/overview`'; then
  echo 'FAIL spa routes should not be rewritten to /openconnector/overview'
  exit 1
fi
echo "$JS" | grep -q '/openconnector/api/providers' && echo 'api_path_OK' || { echo 'FAIL api paths not prefixed'; exit 1; }
if echo "$JS" | grep -qE '/openconnector/openconnector/'; then
  echo 'FAIL double /openconnector prefix'
  exit 1
fi

CODE=$(curl -ksS -o /tmp/oc-prov.json -w "%{http_code}" "${PUBLIC}/openconnector/api/providers" -H "Cookie: ${COOKIE}")
echo "providers=$CODE"
[[ "$CODE" == "200" ]] || exit 1

# Escaped SPA path should redirect into prefix
RED=$(curl -ksS -o /dev/null -w "%{http_code} %{redirect_url}" "${PUBLIC}/overview")
echo "overview_redirect=$RED"
echo "$RED" | grep -q '302' && echo "$RED" | grep -q '/openconnector/overview' && echo 'spa_bounce_OK' || echo 'WARN spa bounce unexpected'

echo "OC_SPA_PROXY_OK"
