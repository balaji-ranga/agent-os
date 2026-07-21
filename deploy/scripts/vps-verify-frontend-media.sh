#!/usr/bin/env bash
# Quick verify after frontend deploy: responsive + hPanel/fullscreen UI markers + media auth.
#
# Usage (on VPS):
#   bash /opt/agent-os/deploy/scripts/vps-verify-frontend-media.sh
#   PUBLIC_HOST=your.domain bash deploy/scripts/vps-verify-frontend-media.sh
set -euo pipefail
cd "${AGENT_OS_ROOT:-/opt/agent-os}/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"
PUBLIC_HOST="${PUBLIC_HOST:-76.13.209.30}"

CSS=$(docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | tr -d '\n' || true)
JS=$(docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.js' 2>/dev/null | tr -d '\n' || true)

check_css() {
  local name="$1"
  local n
  n=$(echo "$CSS" | grep -c "$name" || true)
  echo "CSS $name: $n"
  [[ "$n" -gt 0 ]] || echo "    WARN: missing $name"
}

check_js() {
  local name="$1"
  local n
  n=$(echo "$JS" | grep -c "$name" || true)
  echo "JS $name: $n"
  [[ "$n" -gt 0 ]] || echo "    WARN: missing $name"
}

echo "==> responsive / media"
check_css 'app-mobile-topbar'
check_css 'chat-inline-media'
check_js 'Open full size'

echo "==> hPanel light shell"
check_css 'app-topbar'
check_css 'profile-menu'
check_css 'nav-section-chevron'
check_css '#f7f8f9'

echo "==> workflow fullscreen + CTAs"
check_css 'shell-focus-mode'
check_css 'wf-editor-exit'
check_css 'page-hero'
check_js 'Exit to workflows'
check_js 'Register MCP'
check_js 'Register Agents'

HTML=$(curl -skL "https://${PUBLIC_HOST}/" 2>/dev/null || true)
echo "title: $(echo "$HTML" | sed -n 's/.*<title>\([^<]*\)<\/title>.*/\1/p' | head -1)"
echo "frontend_http: $(curl -skL -o /dev/null -w '%{http_code}' "https://${PUBLIC_HOST}/")"

TOKEN=$(docker compose exec -T -w /opt/agent-os/backend backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import { createSession } from './src/services/auth/session.js';
initDb();
const u = getDb().prepare("SELECT id FROM platform_users WHERE role='ceo' ORDER BY rowid LIMIT 1").get();
process.stdout.write(createSession(u.id).token);
NODE
)
echo "be_unauth=$(docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/media/openclaw/generated/x.png)"
echo "be_auth=$(docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${TOKEN}" http://127.0.0.1:3001/api/media/openclaw/generated/x.png)"
echo FRONTEND_MEDIA_VERIFY_DONE
