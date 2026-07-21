#!/usr/bin/env bash
# Verify proxied OC console assets rewrite API paths (needs admin cookie).
set -euo pipefail
ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
PUBLIC="${AGENT_OS_PUBLIC_URL:-https://flolah.cloud}"
PUBLIC="${PUBLIC%/}"

COOKIE=$(docker compose exec -T backend node -e "
import { createOcConsoleLaunchCookie } from './src/services/openconnector-console-proxy.js';
const c = createOcConsoleLaunchCookie({ id: 'admin', role: 'admin' });
process.stdout.write(c.name + '=' + encodeURIComponent(c.value));
")

HTML=$(curl -ksS "${PUBLIC}/openconnector/" -H "Cookie: ${COOKIE}")
ASSET=$(echo "$HTML" | grep -oE '/openconnector/assets/index-[^.]+\.js' | head -1)
echo "ASSET=$ASSET"
JS=$(curl -ksS "${PUBLIC}${ASSET}" -H "Cookie: ${COOKIE}" | head -c 600000)
if echo "$JS" | grep -q '`/api/'; then
  echo "FAIL: proxied JS still has bare \`/api/"
  exit 1
fi
if ! echo "$JS" | grep -q '/openconnector/api/'; then
  echo "FAIL: proxied JS missing /openconnector/api/"
  exit 1
fi
CODE=$(curl -ksS -o /dev/null -w "%{http_code}" "${PUBLIC}/openconnector/api/providers" -H "Cookie: ${COOKIE}")
echo "providers http=$CODE (expect 200)"
if [[ "$CODE" != "200" ]]; then exit 1; fi
echo "OC_PROXY_OK"
