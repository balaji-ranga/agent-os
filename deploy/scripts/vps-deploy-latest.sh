#!/usr/bin/env bash
# Deploy latest Agent OS code on the VPS: rebuild images + recreate services.
#
# Usage (on VPS):
#   bash /opt/agent-os/deploy/scripts/vps-deploy-latest.sh
#   SKIP_GIT=1 bash deploy/scripts/vps-deploy-latest.sh          # after manual rsync/scp
#   SERVICES=frontend bash deploy/scripts/vps-deploy-latest.sh   # frontend-only
#
# Typical flow from a laptop when VPS cannot git-pull GitHub:
#   1) git push origin main
#   2) .\deploy\scripts\sync-to-vps.ps1   (or rsync/scp)
#   3) SKIP_GIT=1 bash /opt/agent-os/deploy/scripts/vps-deploy-latest.sh
#
# Env:
#   SERVICES=frontend backend openclaw   # compose services to rebuild
#   SKIP_GIT=1                           # skip git pull
#   SKIP_SMOKE=1                         # skip email_send / notify_ceo / org sync / A2A smoke
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"
cd "$ROOT/deploy"

SERVICES="${SERVICES:-frontend backend openclaw}"
SKIP_GIT="${SKIP_GIT:-0}"
SKIP_SMOKE="${SKIP_SMOKE:-0}"
PUBLIC_URL="${AGENT_OS_PUBLIC_URL:-https://127.0.0.1}"

if [[ -f "$ROOT/deploy/scripts/ensure-deepseek-env.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-deepseek-env.sh" 2>/dev/null || true
  bash "$ROOT/deploy/scripts/ensure-deepseek-env.sh" "$ROOT/deploy/.env" || true
fi

echo "==> Agent OS deploy latest $(date -Is)"
echo "    root=$ROOT services=$SERVICES skip_git=$SKIP_GIT"
echo "    features: notify_ceo, email_send, org sync (ORG.md/AGENTS.md), AgentExchange/A2A"

if [[ "$SKIP_GIT" != "1" ]]; then
  if [[ -d "$ROOT/.git" ]]; then
    echo "==> git pull"
    GIT_TERMINAL_PROMPT=0 git -C "$ROOT" fetch origin 2>/dev/null || true
    if GIT_TERMINAL_PROMPT=0 git -C "$ROOT" pull --ff-only origin main 2>/dev/null; then
      echo "    HEAD=$(git -C "$ROOT" rev-parse --short HEAD)"
    else
      echo "    WARN: git pull failed (no credentials / network)."
      echo "    Sync code another way, then re-run with SKIP_GIT=1"
    fi
  else
    echo "    WARN: $ROOT is not a git checkout — set SKIP_GIT=1 after syncing files"
  fi
else
  echo "==> SKIP_GIT=1 (using files already on disk)"
fi

echo "==> docker compose build $SERVICES"
# shellcheck disable=SC2086
docker compose build $SERVICES

if grep -qE '^DEEPSEEK_API_KEY=.+' .env 2>/dev/null; then
  echo "==> optional-deepseek profile (DEEPSEEK_API_KEY set)"
  docker compose --profile optional-deepseek build deepseek
  docker compose --profile optional-deepseek up -d deepseek
fi

echo "==> recreate $SERVICES + nginx"
# shellcheck disable=SC2086
docker compose up -d --force-recreate $SERVICES
docker compose up -d --force-recreate nginx
# OpenClaw entrypoint re-applies configure-openclaw-docker.js (tools.allow, codex off, etc.)

echo "==> wait for backend health"
ok=0
for i in $(seq 1 40); do
  if curl -kfsS "${PUBLIC_URL%/}/api/health" >/dev/null 2>&1 \
    || curl -kfsS https://127.0.0.1/api/health >/dev/null 2>&1 \
    || docker compose exec -T backend curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
    ok=1
    echo "    healthy after ${i} tries"
    break
  fi
  sleep 3
done
if [[ "$ok" != "1" ]]; then
  echo "ERROR: backend health check failed"
  docker compose ps
  exit 1
fi

echo "==> smoke"
curl -kfsS -o /dev/null -w "frontend=%{http_code}\n" "${PUBLIC_URL%/}/" 2>/dev/null \
  || curl -kfsS -o /dev/null -w "frontend=%{http_code}\n" https://127.0.0.1/ || true

if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q 'app-mobile-topbar'; then
  echo "    frontend assets: app-mobile-topbar OK"
else
  echo "    WARN: app-mobile-topbar not found in frontend CSS (rebuild frontend?)"
fi

# AgentExchange SPA shell + A2A modal CSS (PublishA2AModal)
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q 'wf-a2a-modal'; then
  echo "    frontend assets: wf-a2a-modal OK"
else
  echo "    WARN: wf-a2a-modal not found in frontend CSS (Publish A2A modal styles missing?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql agent-exchange /usr/share/nginx/html/assets/*.js 2>/dev/null || grep -Rql AgentExchange /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: AgentExchange route OK"
else
  echo "    WARN: AgentExchange not found in frontend JS bundle"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Resync ORG" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Resync ORG.md button OK"
else
  echo "    WARN: Resync ORG button not found in frontend JS (Dashboard org sync UI missing?)"
fi

TOKEN=$(docker compose exec -T -w /opt/agent-os/backend backend node --input-type=module <<'NODE' 2>/dev/null || true
import { initDb, getDb } from './src/db/schema.js';
import { createSession } from './src/services/auth/session.js';
initDb();
const u = getDb().prepare("SELECT id FROM platform_users WHERE role='ceo' ORDER BY rowid LIMIT 1").get();
if (!u) process.exit(2);
process.stdout.write(createSession(u.id).token);
NODE
)
if [[ -n "${TOKEN:-}" ]]; then
  UNAUTH=$(docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/media/openclaw/generated/x.png || echo 000)
  AUTH=$(docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${TOKEN}" http://127.0.0.1:3001/api/media/openclaw/generated/x.png || echo 000)
  echo "    media unauth=$UNAUTH auth=$AUTH (expect 401 / 404)"
  EX=$(docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${TOKEN}" http://127.0.0.1:3001/api/agent-exchange || echo 000)
  echo "    agent-exchange auth=$EX (expect 200)"
  ORG=$(docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" http://127.0.0.1:3001/api/agents/org/sync || echo 000)
  echo "    agents/org/sync auth=$ORG (expect 200)"
fi

if [[ "$SKIP_SMOKE" != "1" ]]; then
  if [[ -f "$ROOT/deploy/scripts/vps-smoke-new-features.sh" ]]; then
    echo "==> new-features smoke (email_send + notify_ceo + org sync + A2A)"
    sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-smoke-new-features.sh" 2>/dev/null || true
    bash "$ROOT/deploy/scripts/vps-smoke-new-features.sh" || echo "WARN: new-features smoke failed (non-fatal)"
  fi
  if grep -qE '^DEEPSEEK_API_KEY=.+' .env 2>/dev/null && [[ -f "$ROOT/deploy/scripts/vps-smoke-deepseek-brain.sh" ]]; then
    echo "==> DeepSeek brain smoke"
    sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-smoke-deepseek-brain.sh" 2>/dev/null || true
    bash "$ROOT/deploy/scripts/vps-smoke-deepseek-brain.sh" || echo "WARN: DeepSeek smoke failed (non-fatal)"
  fi
fi

docker compose ps
echo "DEPLOY_LATEST_DONE $(date -Is)"
