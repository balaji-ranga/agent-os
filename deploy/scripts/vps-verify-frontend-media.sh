#!/usr/bin/env bash
# Quick verify after frontend deploy: responsive CSS markers + media auth.
set -euo pipefail
cd "${AGENT_OS_ROOT:-/opt/agent-os}/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"
PUBLIC_HOST="${PUBLIC_HOST:-76.13.209.30}"

CSS=$(docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | tr -d '\n' || true)
JS=$(docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.js' 2>/dev/null | tr -d '\n' || true)

echo "has app-mobile-topbar: $(echo "$CSS" | grep -c 'app-mobile-topbar' || true)"
echo "has chat-inline-media: $(echo "$CSS" | grep -c 'chat-inline-media' || true)"
echo "has Open full size: $(echo "$JS" | grep -c 'Open full size' || true)"

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
