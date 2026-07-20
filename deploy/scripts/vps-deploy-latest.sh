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
#   SKIP_SMOKE=1                         # skip smoke + platform verify
#   NO_CACHE=1                           # docker compose build --no-cache (when layers stale)
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"
cd "$ROOT/deploy"

SERVICES="${SERVICES:-frontend backend openclaw}"
SKIP_GIT="${SKIP_GIT:-0}"
SKIP_SMOKE="${SKIP_SMOKE:-0}"
NO_CACHE="${NO_CACHE:-0}"
PUBLIC_URL="${AGENT_OS_PUBLIC_URL:-https://127.0.0.1}"

if [[ -f "$ROOT/deploy/scripts/ensure-deepseek-env.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-deepseek-env.sh" 2>/dev/null || true
  bash "$ROOT/deploy/scripts/ensure-deepseek-env.sh" "$ROOT/deploy/.env" || true
fi

echo "==> Agent OS deploy latest $(date -Is)"
echo "    root=$ROOT services=$SERVICES skip_git=$SKIP_GIT no_cache=$NO_CACHE"
echo "    features: notify_ceo, email_send, Broadcast (intent notify + paced fan-out), org sync,"
echo "              AGENTS.md COO specialty delegation, Master Data + RAG purposes,"
echo "              chat tool-call icons, notification tooltips, shared NotificationProvider,"
echo "              AgentExchange/A2A, DeepSeek@Ollama"

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

BUILD_ARGS=()
if [[ "$NO_CACHE" == "1" ]]; then
  BUILD_ARGS+=(--no-cache)
  echo "==> docker compose build --no-cache $SERVICES"
else
  echo "==> docker compose build $SERVICES"
fi
# shellcheck disable=SC2086
docker compose build "${BUILD_ARGS[@]}" $SERVICES

# Remove obsolete DeepSeek cloud API proxy container (replaced by Ollama)
docker rm -f agent-os-deepseek-1 2>/dev/null || true

# Avoid Docker name conflicts on force-recreate (orphaned *agent-os-backend-1 leftovers)
for c in $(docker ps -aq --filter "name=agent-os-backend" 2>/dev/null || true); do
  name=$(docker inspect -f '{{.Name}}' "$c" 2>/dev/null | sed 's#^/##')
  if [[ "$name" == *"_agent-os-backend-1" || "$name" == "agent-os-backend-1" ]]; then
    docker rm -f "$c" 2>/dev/null || true
  fi
done

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
if docker compose exec -T frontend sh -c 'grep -Rql "Purpose / description" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Master Data purpose UI OK"
else
  echo "    WARN: Master Data purpose UI not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql NotificationProvider /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: NotificationProvider (shared bell) OK"
else
  echo "    WARN: NotificationProvider not found in frontend JS (rebuild frontend? try NO_CACHE=1)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql standupNotificationsDismiss /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: notification dismiss API client OK"
else
  echo "    WARN: notification dismiss UI not found in frontend JS (rebuild frontend? try NO_CACHE=1)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql Broadcast /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Broadcast page OK"
else
  echo "    WARN: Broadcast page not found in frontend JS (rebuild frontend?)"
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
  if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/refresh-coo-workspace-docs.js 2>/dev/null; then
    docker compose exec -T -w /opt/agent-os/backend backend node scripts/refresh-coo-workspace-docs.js >/tmp/coo-docs-refresh.log 2>&1 \
      && echo "    COO workspace docs refresh OK" \
      || echo "    WARN: COO workspace docs refresh failed"
  fi
  BC=$(docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -d '{"message":"ping","agent_ids":["__deploy_smoke_no_agent__"]}' http://127.0.0.1:3001/api/broadcast || echo 000)
  echo "    broadcast auth empty-target=$BC (expect 200)"
fi

if [[ "$SKIP_SMOKE" != "1" ]]; then
  if [[ -f "$ROOT/deploy/scripts/vps-smoke-new-features.sh" ]]; then
    echo "==> new-features smoke (email_send + notify_ceo + master_data + org sync + A2A + shared notification dismiss)"
    sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-smoke-new-features.sh" 2>/dev/null || true
    bash "$ROOT/deploy/scripts/vps-smoke-new-features.sh" || echo "WARN: new-features smoke failed (non-fatal)"
  fi
  if [[ -f "$ROOT/deploy/scripts/vps-smoke-broadcast-notify.sh" ]]; then
    echo "==> Broadcast → notify_ceo smoke (TechResearcher)"
    sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-smoke-broadcast-notify.sh" 2>/dev/null || true
    bash "$ROOT/deploy/scripts/vps-smoke-broadcast-notify.sh" || echo "WARN: broadcast notify smoke failed (non-fatal — needs OpenClaw + GPT)"
  fi
  if [[ -f "$ROOT/deploy/scripts/vps-smoke-deepseek-brain.sh" ]]; then
    echo "==> DeepSeek (Ollama) brain smoke"
    sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-smoke-deepseek-brain.sh" 2>/dev/null || true
    bash "$ROOT/deploy/scripts/vps-smoke-deepseek-brain.sh" || echo "WARN: DeepSeek Ollama smoke failed (non-fatal — check RAM/disk for deepseek-v3)"
  fi
  if [[ -f "$ROOT/deploy/scripts/vps-verify-platform.sh" ]]; then
    echo "==> platform verify (Master Data, delegation, allowlists)"
    sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-verify-platform.sh" 2>/dev/null || true
    bash "$ROOT/deploy/scripts/vps-verify-platform.sh" || echo "WARN: platform verify failed (non-fatal)"
  fi
fi

docker compose ps
echo "DEPLOY_LATEST_DONE $(date -Is)"
