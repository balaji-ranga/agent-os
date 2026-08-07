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
#   SKIP_DOCKER_PRUNE=1                  # skip post-build BuildKit cache hygiene
#   DOCKER_BUILDER_PRUNE_ALL=1           # wipe all unused build cache (slow next build)
#   DOCKER_BUILDER_PRUNE_UNTIL=72h       # keep recent cache; prune older (default)
#   SKIP_PLATFORM_MCPS=1                 # skip Brave + Meta Graph MCP containers/seeds
#   SKIP_VOICE=1 / SKIP_EMBEDDINGS=1     # skip optional-voice / embeddings
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml:docker-compose.docker-tools.yml}"
cd "$ROOT/deploy"

SERVICES="${SERVICES:-frontend backend openclaw}"
SKIP_GIT="${SKIP_GIT:-0}"
SKIP_SMOKE="${SKIP_SMOKE:-0}"
NO_CACHE="${NO_CACHE:-0}"
PUBLIC_URL="${AGENT_OS_PUBLIC_URL:-}"
if [[ -z "$PUBLIC_URL" && -f "$ROOT/deploy/.env" ]]; then
  PUBLIC_URL="$(grep -E '^AGENT_OS_PUBLIC_URL=' "$ROOT/deploy/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)"
fi
PUBLIC_URL="${PUBLIC_URL:-https://127.0.0.1}"

if [[ -f "$ROOT/deploy/scripts/ensure-deepseek-env.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-deepseek-env.sh" 2>/dev/null || true
  bash "$ROOT/deploy/scripts/ensure-deepseek-env.sh" "$ROOT/deploy/.env" || true
fi
if [[ -f "$ROOT/deploy/scripts/ensure-workflow-certify-env.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-workflow-certify-env.sh" 2>/dev/null || true
  bash "$ROOT/deploy/scripts/ensure-workflow-certify-env.sh" "$ROOT/deploy/.env" || true
fi
if [[ -f "$ROOT/deploy/scripts/ensure-cron-env.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-cron-env.sh" 2>/dev/null || true
  bash "$ROOT/deploy/scripts/ensure-cron-env.sh" "$ROOT/deploy/.env" || true
fi
if [[ -f "$ROOT/deploy/scripts/ensure-opensearch-env.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-opensearch-env.sh" 2>/dev/null || true
  bash "$ROOT/deploy/scripts/ensure-opensearch-env.sh" "$ROOT/deploy/.env" || true
fi
if [[ -f "$ROOT/deploy/scripts/ensure-docker-tools-env.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-docker-tools-env.sh" 2>/dev/null || true
  bash "$ROOT/deploy/scripts/ensure-docker-tools-env.sh" "$ROOT/deploy/.env" || true
fi
if [[ -f "$ROOT/deploy/scripts/ensure-voice-env.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-voice-env.sh" 2>/dev/null || true
  # Env keys first; containers after image build (VOICE_BUILD=0 here — started below)
  VOICE_BUILD=0 bash "$ROOT/deploy/scripts/ensure-voice-env.sh" "$ROOT/deploy/.env" || true
fi
if [[ -f "$ROOT/deploy/scripts/ensure-embeddings-env.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-embeddings-env.sh" 2>/dev/null || true
  # Env keys first; start/build embeddings container below
  EMBEDDINGS_BUILD=0 SKIP_EMBEDDINGS=1 bash "$ROOT/deploy/scripts/ensure-embeddings-env.sh" "$ROOT/deploy/.env" || true
fi
if [[ -f "$ROOT/deploy/scripts/ensure-platform-mcps.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-platform-mcps.sh" 2>/dev/null || true
  # Env keys only; build/start/seed after backend is healthy
  SKIP_PLATFORM_MCPS=1 bash "$ROOT/deploy/scripts/ensure-platform-mcps.sh" "$ROOT/deploy/.env" || true
fi

# OpenSearch requires elevated mmap counts
if [[ "$(id -u)" -eq 0 ]] || command -v sudo >/dev/null 2>&1; then
  cur="$(sysctl -n vm.max_map_count 2>/dev/null || echo 0)"
  if [[ "${cur:-0}" -lt 262144 ]]; then
    echo "==> setting vm.max_map_count=262144 (was $cur)"
    if [[ "$(id -u)" -eq 0 ]]; then
      sysctl -w vm.max_map_count=262144 >/dev/null || true
    else
      sudo sysctl -w vm.max_map_count=262144 >/dev/null || true
    fi
  fi
fi

echo "==> Agent OS deploy latest $(date -Is)"
echo "    root=$ROOT services=$SERVICES skip_git=$SKIP_GIT no_cache=$NO_CACHE"
echo "    features: notify_ceo, email_send, Broadcast (intent notify + paced fan-out), org sync,"
echo "              AGENTS.md COO specialty delegation, Master Data + RAG purposes,"
echo "              Platform Help agent + knowledgebase/platform-help corpus,"
echo "              Kanban owner_user_id isolation (SQL-scoped; shared agents never imply ownership),"
echo "              lean Kanban board (generic tasks; no Job applications filter / pipeline banner),"
echo "              lean CEO onboard + OrgDesigner, pruneSharedStandardAgentGrants at boot,"
echo "              chat tool-call icons, notification tooltips + datetime, shared NotificationProvider,"
echo "              CEO Policies/guardrails (POLICY.md + Brain prepend),"
echo "              deploy smokes clean up CEO standup/notify pollution,"
echo "              AgentExchange/A2A (Test agent UI, sync/async+callback, deny_all default IP,"
echo "              Admin A2A logs /admin/a2a-invocations,"
echo "              allow/whitelist; vps-client-ip compose; owner unpublish),"
echo "              workflow API/MCP/A2A auth templates ({{nodeId.path}} bearer/headers),"
echo "              platform MCPs ensure-platform-mcps.sh (Brave BYOK + Meta Graph OAuth),"
echo "              Connectors → MCPs tab (platform / CEO App override OAuth; FACEBOOK_APP_*; help 31),"
echo "              Workflow certify Maker/Checker (LLM Checker default OFF),"
echo "              DeepSeek@Ollama,"
echo "              hPanel shell + light/dark theme (ThemeToggle, data-theme),"
echo "              workflow editor fullscreen (shell-focus-mode + Exit to workflows),"
echo "              workflow run audit fullscreen (/workflows/runs/:id + wf-run-audit-layout),"
echo "              Register MCP / Register Agents primary CTAs (page-hero),"
echo "              department purpose + monthly_token_budget (Master Data departments),"
echo "              agent monthly token + error budgets (token_usage ledger, warn-then-block),"
echo "              Efficiency View Org / Department / Agent tabs + Reset usage (MTD tokens → 0),"
echo "              Org Storage (MB); COO status_checker (standup+HTML email; cron+Dashboard);"
echo "              Scheduled goals (CEO prompts → agents; SCHEDULED_GOALS_CRON;"
echo "              cadence hourly|daily|weekdays|weekly; UI create/edit/pause;"
echo "              verify: vps-verify-scheduled-goals.sh + platform-help 28);"
echo "              data retention days (profile) + daily purge (chats/workflows + Content Explorer media),"
echo "              Content Explorer hard-delete (selected/all) + storage includes media/generated/<ceo>,"
echo "              Profile LLM catalog (provider+model) + OPENAI_BYOK_MODEL soft fallback,"
echo "              cron reference block in deploy/.env (ensure-cron-env.sh) + help doc 19 scheduled jobs,"
echo "              external/A2A agents as org leaf members (Add to org) + COO delegation to them,"
echo "              A2A visibility public|private (private = org COO/reports-to only; public endpoints denied),"
echo "              Master Data Purge all uploads (CEO uploads only; Help + User Guide protected),"
echo "              OpenSearch document RAG (per-user meta+search indices; platform_docs_*;"
echo "              admin Documents RAG + /opensearch/ Dashboards BFF; no host :9200/:5601),"
echo "              agent delete cascade + deleted_agents tombstone (no FK error, no resurrection),"
echo "              Published Scenes (/p/vr/:slug) + public VR APIs,"
echo "              Slack/WhatsApp agent channels wizard (vault + OpenClaw bindings),"
echo "              WhatsApp groupPolicy=disabled by default (blocks @g.us before media),"
echo "              free STT/TTS optional-voice (whisper+piper; ensure-voice-env.sh + SPEECH_*)"
echo "              local Qwen embeddings (optional-embeddings; ensure-embeddings-env.sh; no OpenAI)"
echo "              CEO home chat (COO default) + My Org (/org); Profile role_title display label"
echo "              Chat history/browser panes closed by default (icon toggles);"
echo "              COO SOUL inbound list→index→RAG + org-context tools line;"
echo "              COO skip hard-delegate for don't-delegate + find/download/attach files"
echo "              Marketing apex flolah.cloud + app login.flolah.cloud; acme.sh TLS-ALPN cert script"

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

# Reclaim BuildKit/containerd cache after builds (keeps last DOCKER_BUILDER_PRUNE_UNTIL by default).
# Does not remove compose volumes or Admin-onboarded tool containers.
if [[ -f "$ROOT/deploy/scripts/docker-disk-hygiene.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/docker-disk-hygiene.sh" 2>/dev/null || true
  bash "$ROOT/deploy/scripts/docker-disk-hygiene.sh" || echo "WARN: docker-disk-hygiene failed"
fi

echo "==> recreate $SERVICES + nginx"
# Marketing homepage files must be world-readable for the nginx worker (git/scp may leave 700)
if [[ -d "$ROOT/deploy/static/flolah-home" ]]; then
  chmod -R a+rX "$ROOT/deploy/static/flolah-home" 2>/dev/null || true
  if [[ ! -f "$ROOT/deploy/static/flolah-home/index.html" ]]; then
    echo "ERROR: deploy/static/flolah-home/index.html missing (marketing apex site)"
    exit 1
  fi
else
  echo "ERROR: deploy/static/flolah-home missing — marketing homepage not in tree"
  exit 1
fi
# shellcheck disable=SC2086
docker compose up -d --force-recreate $SERVICES
docker compose up -d --force-recreate nginx

# OpenSearch + Dashboards (document RAG) — always ensure running; not in default SERVICES rebuild list
echo "==> ensure OpenSearch + Dashboards (internal only)"
docker compose up -d opensearch opensearch-dashboards || echo "WARN: OpenSearch up failed"
# OpenClaw entrypoint re-applies configure-openclaw-docker.js (tools.allow, codex off, etc.)

# Free STT/TTS (optional-voice) — SPEECH_* already in .env from ensure-voice-env above
if [[ -f "$ROOT/deploy/scripts/ensure-voice-env.sh" && "${SKIP_VOICE:-0}" != "1" ]]; then
  echo "==> optional-voice (whisper + piper TTS)"
  docker compose --profile optional-voice build "${BUILD_ARGS[@]}" piper || echo "WARN: piper build failed"
  docker compose --profile optional-voice up -d whisper piper || echo "WARN: optional-voice up failed"
fi

# Local Qwen embeddings for OpenSearch hybrid RAG (no OpenAI)
if [[ -f "$ROOT/deploy/scripts/ensure-embeddings-env.sh" && "${SKIP_EMBEDDINGS:-0}" != "1" ]]; then
  echo "==> optional-embeddings (Qwen/Qwen3-Embedding-0.6B)"
  docker compose --profile optional-embeddings build "${BUILD_ARGS[@]}" embeddings || echo "WARN: embeddings build failed"
  EMBEDDINGS_BUILD=0 bash "$ROOT/deploy/scripts/ensure-embeddings-env.sh" "$ROOT/deploy/.env" || echo "WARN: embeddings ensure failed"
fi

echo "==> refresh OpenClaw chrome-extension asset (Browser Session download)"
if [[ -f "${ROOT}/deploy/scripts/sync-openclaw-chrome-extension.sh" ]]; then
  FORCE_SYNC=0 bash "${ROOT}/deploy/scripts/sync-openclaw-chrome-extension.sh" || \
    echo "[deploy] WARN: chrome-extension sync skipped"
fi
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

# Platform MCPs (Brave BYOK + Meta Graph OAuth): rebuild containers + seed is_platform=1 registry rows
if [[ -f "$ROOT/deploy/scripts/ensure-platform-mcps.sh" && "${SKIP_PLATFORM_MCPS:-0}" != "1" ]]; then
  echo "==> platform MCPs (brave-search-mcp + meta-graph-mcp + registry seeds)"
  NO_CACHE="${NO_CACHE:-0}" PLATFORM_MCP_BUILD=1 \
    bash "$ROOT/deploy/scripts/ensure-platform-mcps.sh" "$ROOT/deploy/.env" \
    || echo "WARN: ensure-platform-mcps failed (non-fatal)"
fi

echo "==> smoke"
# Prefer explicit hosts when PUBLIC_URL is the app subdomain (login.flolah.cloud)
APEX_URL="${FLOLAH_APEX_URL:-https://flolah.cloud}"
# Load AGENT_OS_PUBLIC_URL from deploy/.env if not in environment
if [[ -z "${AGENT_OS_PUBLIC_URL:-}" && -f "$ROOT/deploy/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(AGENT_OS_PUBLIC_URL|FLOLAH_APEX_URL)=' "$ROOT/deploy/.env" | sed 's/\r$//') || true
  set +a
  PUBLIC_URL="${AGENT_OS_PUBLIC_URL:-$PUBLIC_URL}"
fi
curl -kfsS -o /dev/null -w "frontend=%{http_code}\n" "${PUBLIC_URL%/}/" 2>/dev/null \
  || curl -kfsS -o /dev/null -w "frontend=%{http_code}\n" https://127.0.0.1/ || true

# Marketing apex homepage (Host: flolah.cloud) — content from deploy/static/flolah-home
if curl -kfsS -H "Host: flolah.cloud" https://127.0.0.1/ 2>/dev/null | grep -q 'Start with Flolah'; then
  echo "    marketing apex (Host flolah.cloud): Start with Flolah OK"
elif curl -kfsS "${APEX_URL%/}/" 2>/dev/null | grep -q 'Start with Flolah'; then
  echo "    marketing apex ${APEX_URL}: Start with Flolah OK"
else
  echo "    WARN: marketing homepage marker missing (static mount or nginx vhost?)"
fi
if curl -kfsS -o /dev/null -w "  mark_png=%{http_code}\n" -H "Host: flolah.cloud" https://127.0.0.1/assets/flolah-mark.png 2>/dev/null \
  || curl -kfsS -o /dev/null -w "  mark_png=%{http_code}\n" "${APEX_URL%/}/assets/flolah-mark.png" 2>/dev/null; then
  :
else
  echo "    WARN: marketing asset /assets/flolah-mark.png not reachable"
fi
if docker compose exec -T nginx test -f /usr/share/nginx/flolah-home/index.html 2>/dev/null; then
  echo "    nginx mount: /usr/share/nginx/flolah-home/index.html OK"
else
  echo "    WARN: /usr/share/nginx/flolah-home/index.html missing in nginx container"
fi

if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q 'app-mobile-topbar'; then
  echo "    frontend assets: app-mobile-topbar OK"
else
  echo "    WARN: app-mobile-topbar not found in frontend CSS (rebuild frontend?)"
fi

# hPanel shell + light/dark theme (topbar, profile menu, ThemeToggle, CSS tokens)
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q 'app-topbar'; then
  echo "    frontend assets: app-topbar (hPanel shell) OK"
else
  echo "    WARN: app-topbar not found in frontend CSS (hPanel theme missing? rebuild frontend)"
fi
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q 'profile-menu'; then
  echo "    frontend assets: profile-menu OK"
else
  echo "    WARN: profile-menu not found in frontend CSS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q '#f7f8f9'; then
  echo "    frontend assets: light theme token (--bg #f7f8f9) OK"
else
  echo "    WARN: light theme bg token missing (stale frontend? try NO_CACHE=1)"
fi
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q 'theme-toggle-btn'; then
  echo "    frontend assets: theme-toggle-btn OK"
else
  echo "    WARN: theme-toggle-btn not found in frontend CSS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q '#0f1115'; then
  echo "    frontend assets: dark theme token (--bg #0f1115) OK"
else
  echo "    WARN: dark theme bg token missing (stale frontend? try NO_CACHE=1)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql ProfileMenu /usr/share/nginx/html/assets/*.js 2>/dev/null || grep -Rql profile-menu /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: ProfileMenu JS OK"
else
  echo "    WARN: ProfileMenu not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql agent-os-theme /usr/share/nginx/html/assets/*.js 2>/dev/null || grep -Rql "Switch to dark" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: ThemeToggle / agent-os-theme OK"
else
  echo "    WARN: ThemeToggle not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql nav-section-chevron /usr/share/nginx/html/assets/*.css 2>/dev/null || cat /usr/share/nginx/html/assets/*.css 2>/dev/null | grep -q nav-section-chevron'; then
  echo "    frontend assets: collapsible nav sections OK"
else
  echo "    WARN: nav-section-chevron not found (collapsible menus missing?)"
fi
# Tools nav (UI label; route remains /content-tools) + Agent Workspaces Add agent
# (component names are minified away — use stable UI strings)
if docker compose exec -T frontend sh -c 'grep -Rql "Reports to (COO default)" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Add agent form (Agent Workspaces) OK"
else
  echo "    WARN: Add agent form strings not found in frontend JS (workspace Add agent missing?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql agent-workspace-card /usr/share/nginx/html/assets/*.css 2>/dev/null || cat /usr/share/nginx/html/assets/*.css 2>/dev/null | grep -q agent-workspace-card'; then
  echo "    frontend assets: agent-workspace-card OK"
else
  echo "    WARN: agent-workspace-card CSS missing (rebuild frontend?)"
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
if docker compose exec -T frontend sh -c 'grep -Rql "Test agent" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: AgentExchange Test agent UI OK"
else
  echo "    WARN: Test agent button not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql agentExchangeTest /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: agentExchangeTest API client OK"
else
  echo "    WARN: agentExchangeTest not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Deny all" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: deny_all access policy badge OK"
else
  echo "    WARN: Deny all IP policy label not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "A2A invocation logs" /usr/share/nginx/html/assets/*.js 2>/dev/null || grep -Rql adminA2AInvocations /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Admin A2A invocation logs OK"
else
  echo "    WARN: Admin A2A logs page not found in frontend JS (rebuild frontend?)"
fi
if [[ -f "$ROOT/backend/src/routes/admin.js" ]] \
  && grep -q 'a2a-invocations' "$ROOT/backend/src/routes/admin.js"; then
  echo "    backend source: GET /admin/a2a-invocations OK"
else
  echo "    WARN: admin a2a-invocations route not found"
fi
if [[ -f "$ROOT/backend/src/routes/agent-exchange.js" ]] \
  && grep -q '/:publishId/test' "$ROOT/backend/src/routes/agent-exchange.js"; then
  echo "    backend source: agent-exchange /:publishId/test route OK"
else
  echo "    WARN: agent-exchange test route not found in backend source"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "OAuth client credentials" /usr/share/nginx/html/assets/*.js 2>/dev/null || grep -Rql rotate_credentials /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: A2A Public/Secured (OAuth) UI OK"
else
  echo "    WARN: A2A OAuth publish UI strings not found (rebuild frontend?)"
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
if docker compose exec -T frontend sh -c 'grep -Rql "Purge all uploads" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Master Data Purge all uploads OK"
else
  echo "    WARN: Purge all uploads not found in frontend JS (rebuild frontend?)"
fi
if [[ -f "$ROOT/backend/src/services/master-data-protected-docs.js" ]] \
  && grep -q 'isProtectedPlatformDocument' "$ROOT/backend/src/services/master-data-protected-docs.js"; then
  echo "    backend source: protected Master Data docs helper OK"
else
  echo "    WARN: master-data-protected-docs.js missing"
fi
if [[ -f "$ROOT/backend/src/services/master-data.js" ]] \
  && grep -q 'purgeAllUserDocuments' "$ROOT/backend/src/services/master-data.js"; then
  echo "    backend source: purgeAllUserDocuments OK"
else
  echo "    WARN: purgeAllUserDocuments missing in master-data.js"
fi
if [[ -f "$ROOT/backend/src/routes/master-data.js" ]] \
  && grep -q 'documents/purge-all' "$ROOT/backend/src/routes/master-data.js"; then
  echo "    backend source: POST /documents/purge-all route OK"
else
  echo "    WARN: /documents/purge-all route missing"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-purge-all-documents.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-purge-all-documents.js >/tmp/purge-all-verify.log 2>&1 \
    && echo "    Master Data purge-all + protected docs unit test OK" \
    || echo "    WARN: purge-all unit test failed (see /tmp/purge-all-verify.log)"
fi
if [[ -f "$ROOT/backend/src/services/agent-delete.js" ]] \
  && grep -q 'deleteAgentCascade' "$ROOT/backend/src/services/agent-delete.js"; then
  echo "    backend source: agent delete cascade service OK"
else
  echo "    WARN: agent-delete.js (deleteAgentCascade) missing"
fi
if grep -q 'isAgentTombstoned' "$ROOT/backend/src/routes/openclaw.js" 2>/dev/null; then
  echo "    backend source: OpenClaw sync honours deleted_agents tombstones OK"
else
  echo "    WARN: openclaw sync does not check tombstones (deleted agents can come back)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-agent-delete-cascade.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-agent-delete-cascade.js >/tmp/agent-delete-verify.log 2>&1 \
    && echo "    agent delete cascade + tombstone unit test OK" \
    || echo "    WARN: agent delete unit test failed (see /tmp/agent-delete-verify.log)"
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
if docker compose exec -T frontend sh -c 'grep -Rql "Exit to workflows" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: workflow editor exit fullscreen OK"
else
  echo "    WARN: Exit to workflows not found (fullscreen editor missing?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql shell-focus-mode /usr/share/nginx/html/assets/*.js 2>/dev/null || cat /usr/share/nginx/html/assets/*.css 2>/dev/null | grep -q shell-focus-mode'; then
  echo "    frontend assets: shell-focus-mode OK"
else
  echo "    WARN: shell-focus-mode not found (workflow fullscreen shell hide missing?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Register MCP" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Register MCP CTA OK"
else
  echo "    WARN: Register MCP CTA not found"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Register Agents" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Register Agents CTA OK"
else
  echo "    WARN: Register Agents CTA not found"
fi
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q 'page-hero'; then
  echo "    frontend assets: page-hero (aligned primary CTAs) OK"
else
  echo "    WARN: page-hero CSS missing (MCP/Agents hero alignment?)"
fi
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q 'wf-editor-exit'; then
  echo "    frontend assets: wf-editor-exit OK"
else
  echo "    WARN: wf-editor-exit CSS missing (fullscreen exit control?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Exit run audit\|wf-run-audit-layout\|/workflows/runs/" /usr/share/nginx/html/assets/*.js 2>/dev/null || cat /usr/share/nginx/html/assets/*.css 2>/dev/null | grep -q wf-run-audit-layout'; then
  echo "    frontend assets: workflow run audit fullscreen OK"
else
  echo "    WARN: run audit fullscreen markers missing (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql Broadcast /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Broadcast page OK"
else
  echo "    WARN: Broadcast page not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql chat-attach-icon-btn /usr/share/nginx/html/assets/*.js 2>/dev/null || cat /usr/share/nginx/html/assets/*.css 2>/dev/null | grep -q chat-attach-icon-btn'; then
  echo "    frontend assets: chat attach icon OK"
else
  echo "    WARN: chat-attach-icon-btn missing (chat paperclip attach UI?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql chat_attachments /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: chat attachments → Master Data RAG OK"
else
  echo "    WARN: chat_attachments not found in frontend JS"
fi
if docker compose exec -T frontend sh -c 'grep -Rql ceoGuardrailsSave /usr/share/nginx/html/assets/*.js 2>/dev/null || grep -Rql "/policies" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: CEO Policies / guardrails OK"
else
  echo "    WARN: CEO Policies UI not found in frontend JS"
fi

# Scheduled goals UI (stale bundle without Edit/Hourly after backend-only deploy)
if docker compose exec -T frontend sh -c 'grep -Rql "scheduled-goals\|scheduledGoalsList\|Scheduled goals" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Scheduled goals route/client OK"
else
  echo "    WARN: Scheduled goals not in frontend bundle (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Save changes\|Edit scheduled goal\|scheduledGoalsUpdate" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Scheduled goals Edit UI OK"
else
  echo "    WARN: Scheduled goals Edit missing in frontend JS (frontend-only rebuild required after UI changes)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql Hourly /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Scheduled goals Hourly cadence OK"
else
  echo "    WARN: Hourly cadence label not in frontend JS"
fi

if docker compose exec -T frontend sh -c 'grep -Rql "Private (org only)" /usr/share/nginx/html/assets/*.js 2>/dev/null || grep -Rql "mcp-pg-card-menu" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: A2A Private visibility + card ⋯ menu UI OK"
else
  echo "    WARN: A2A Private / card menu UI not found in frontend JS (rebuild frontend?)"
fi
if [[ -f "$ROOT/backend/src/services/workflow-a2a-access.js" ]] \
  && grep -q "normalizeA2AVisibility" "$ROOT/backend/src/services/workflow-a2a-access.js"; then
  echo "    backend source: A2A visibility helpers OK"
else
  echo "    WARN: A2A visibility helpers missing in backend source"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-a2a-private-visibility.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-a2a-private-visibility.js >/tmp/a2a-private-verify.log 2>&1 \
    && echo "    A2A private visibility e2e OK" \
    || echo "    WARN: A2A private visibility e2e failed (see /tmp/a2a-private-verify.log)"
fi

# Efficiency Agent View + agent budgets + org leaf members
if docker compose exec -T frontend sh -c 'grep -Rql "Agent View" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Efficiency Agent View tab OK"
else
  echo "    WARN: Agent View tab not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql efficiencyAgents /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: efficiencyAgents API client OK"
else
  echo "    WARN: efficiencyAgents API client not found in frontend JS"
fi
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q 'eff-gauge'; then
  echo "    frontend assets: Agent View budget gauges CSS OK"
else
  echo "    WARN: eff-gauge CSS missing (budget gauges?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "n/a for external agents" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: leaf KPI n/a tip OK"
else
  echo "    WARN: leaf KPI n/a tip not found in frontend JS"
fi
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css' 2>/dev/null | grep -q 'eff-na'; then
  echo "    frontend assets: leaf KPI n/a CSS OK"
else
  echo "    WARN: eff-na CSS missing (leaf KPI n/a?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Monthly token budget" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: monthly token budget fields OK"
else
  echo "    WARN: Monthly token budget field not found in frontend JS"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Add to org" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Add to org (external/A2A leaf members) OK"
else
  echo "    WARN: Add to org action not found in frontend JS"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "org-leaf-badge" /usr/share/nginx/html/assets/*.js /usr/share/nginx/html/assets/*.css 2>/dev/null'; then
  echo "    frontend assets: org chart leaf badges (list/graph) OK"
else
  echo "    WARN: org chart leaf badges not found in frontend assets"
fi
if [[ -f "$ROOT/frontend/src/utils/orgHierarchy.js" ]] \
  && grep -q "mergeAgentsWithLeafMembers" "$ROOT/frontend/src/utils/orgHierarchy.js"; then
  echo "    frontend source: mergeAgentsWithLeafMembers helper OK"
else
  echo "    WARN: mergeAgentsWithLeafMembers missing from orgHierarchy.js"
fi
if [[ -f "$ROOT/backend/src/routes/efficiency.js" ]] \
  && grep -q "agents/:memberKey" "$ROOT/backend/src/routes/efficiency.js"; then
  echo "    backend source: GET /efficiency/agents/:memberKey OK"
else
  echo "    WARN: efficiency agent-view route not found in backend source"
fi
if [[ -f "$ROOT/backend/src/routes/org-members.js" ]]; then
  echo "    backend source: /org-members routes OK"
else
  echo "    WARN: backend/src/routes/org-members.js missing"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/verify-budgets-org-members.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/verify-budgets-org-members.js >/tmp/budgets-verify.log 2>&1 \
    && echo "    budgets/org-members schema + warn-then-block verify OK" \
    || echo "    WARN: budgets/org-members verify failed (see /tmp/budgets-verify.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-org-member-delegation-e2e.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-org-member-delegation-e2e.js >/tmp/org-delegation-e2e.log 2>&1 \
    && echo "    COO → external/A2A leaf delegation e2e OK" \
    || echo "    WARN: org member delegation e2e failed (see /tmp/org-delegation-e2e.log)"
fi
if grep -q "extractA2AReply" "$ROOT/backend/src/services/org-member-delegation.js" 2>/dev/null \
  && grep -q "normalizeAllocationKey" "$ROOT/backend/src/services/coo-specialty-delegation.js" 2>/dev/null; then
  echo "    backend source: A2A reply extraction + COO classifier key normalisation OK"
else
  echo "    WARN: org delegation reply/classifier fixes missing in backend source"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-coo-agents-md-preserved.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-coo-agents-md-preserved.js >/tmp/coo-agents-md.log 2>&1 \
    && echo "    COO AGENTS.md survives template sync (leaf members kept) OK" \
    || echo "    WARN: COO AGENTS.md template-clobber regression (see /tmp/coo-agents-md.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-coo-agents-md-merge.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-coo-agents-md-merge.js >/tmp/coo-agents-md-merge.log 2>&1 \
    && echo "    COO AGENTS.md merge preserves manual sections OK" \
    || echo "    WARN: COO AGENTS.md merge regression (see /tmp/coo-agents-md-merge.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-intent-agents-md-parse.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-intent-agents-md-parse.js >/tmp/intent-parse.log 2>&1 \
    && echo "    intent classifier AGENTS.md leaf-key parse OK" \
    || echo "    WARN: intent AGENTS.md parse regression (see /tmp/intent-parse.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-brain-token-attribution.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-brain-token-attribution.js >/tmp/brain-tokens.log 2>&1 \
    && echo "    Brain-node token attribution (a2a leaf / agent / workflow) OK" \
    || echo "    WARN: Brain token attribution regression (see /tmp/brain-tokens.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-internal-delegation-budget-gate.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-internal-delegation-budget-gate.js >/tmp/internal-budget-gate.log 2>&1 \
    && echo "    Internal COO delegation respects agent budgets OK" \
    || echo "    WARN: internal delegation budget gate failed (see /tmp/internal-budget-gate.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-department-efficiency.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-department-efficiency.js >/tmp/dept-eff.log 2>&1 \
    && echo "    Department efficiency rollup OK" \
    || echo "    WARN: department efficiency failed (see /tmp/dept-eff.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-token-usage-reset.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-token-usage-reset.js >/tmp/token-reset.log 2>&1 \
    && echo "    Token usage reset (one / all) OK" \
    || echo "    WARN: token usage reset failed (see /tmp/token-reset.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend grep -q "resetTokenUsage" src/services/token-usage.js 2>/dev/null \
  && docker compose exec -T -w /opt/agent-os/backend backend grep -q "usage/reset" src/routes/efficiency.js 2>/dev/null; then
  echo "    Token usage reset API deployed OK"
else
  echo "    WARN: usage reset API missing"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Reset usage" /usr/share/nginx/html/assets/*.js 2>/dev/null' \
  && docker compose exec -T frontend sh -c 'grep -Rql "Reset all usage" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Reset usage controls OK"
else
  echo "    WARN: Reset usage controls not found in frontend JS"
fi
if [[ -f "$ROOT/deploy/scripts/vps-verify-status-retention-ui.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-verify-status-retention-ui.sh" 2>/dev/null || true
  if bash "$ROOT/deploy/scripts/vps-verify-status-retention-ui.sh" >/tmp/status-retention-ui.log 2>&1; then
    echo "    frontend assets: status checker + retention + storage markers OK"
  else
    echo "    WARN: status/retention UI markers missing (see /tmp/status-retention-ui.log)"
  fi
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/vps-test-status-retention.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/vps-test-status-retention.js >/tmp/status-retention.log 2>&1 \
    && echo "    status checker + retention + storage API OK" \
    || echo "    WARN: status/retention API check failed (see /tmp/status-retention.log)"
fi
if [[ -f "$ROOT/deploy/scripts/vps-verify-scheduled-goals.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-verify-scheduled-goals.sh" 2>/dev/null || true
  if bash "$ROOT/deploy/scripts/vps-verify-scheduled-goals.sh" >/tmp/scheduled-goals-verify.log 2>&1; then
    echo "    scheduled goals verify OK"
  else
    echo "    WARN: scheduled goals verify failed (see /tmp/scheduled-goals-verify.log)"
    tail -20 /tmp/scheduled-goals-verify.log 2>/dev/null || true
  fi
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-standup-get-work-from-team.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-standup-get-work-from-team.js >/tmp/get-work.log 2>&1 \
    && echo "    standup get_work_from_team fanout OK" \
    || echo "    WARN: get_work_from_team check failed (see /tmp/get-work.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-kanban-timezone-and-chat-context.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-kanban-timezone-and-chat-context.js >/tmp/kanban-tz.log 2>&1 \
    && echo "    Kanban platform-timezone dates + archived-chat activity OK" \
    || echo "    WARN: Kanban timezone / chat_context check failed (see /tmp/kanban-tz.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-kanban-orphan-watcher.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-kanban-orphan-watcher.js >/tmp/kanban-orphan.log 2>&1 \
    && echo "    Kanban orphan watcher (stuck processing + reinitiate) OK" \
    || echo "    WARN: Kanban orphan watcher check failed (see /tmp/kanban-orphan.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-a2a-leaf-kanban-complete.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-a2a-leaf-kanban-complete.js >/tmp/a2a-leaf-kanban.log 2>&1 \
    && echo "    A2A/external leaf Kanban complete-from-run OK" \
    || echo "    WARN: A2A leaf Kanban complete check failed (see /tmp/a2a-leaf-kanban.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-a2a-private-local-delegation.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-a2a-private-local-delegation.js >/tmp/a2a-private.log 2>&1 \
    && echo "    private A2A leaf reachable from COO delegation OK" \
    || echo "    WARN: private A2A delegation check failed (see /tmp/a2a-private.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-org-member-delegation-e2e.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-org-member-delegation-e2e.js >/tmp/org-member-e2e.log 2>&1 \
    && echo "    org leaf delegation e2e OK" \
    || echo "    WARN: org leaf delegation e2e failed (see /tmp/org-member-e2e.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/test-help-doc-accuracy.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-help-doc-accuracy.js >/tmp/help-accuracy.log 2>&1 \
    && echo "    platform help corpus answers ambiguous questions correctly" \
    || echo "    WARN: help doc accuracy check failed (see /tmp/help-accuracy.log)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Times in " /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Kanban timezone hint OK"
else
  echo "    WARN: Kanban timezone hint missing from frontend bundle"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "/admin/crons" /usr/share/nginx/html/assets/*.js 2>/dev/null' \
  && docker compose exec -T frontend sh -c 'grep -Rql "Platform crons" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Admin Crons page OK"
else
  echo "    WARN: Admin Crons UI markers missing"
fi
if docker compose exec -T -w /opt/agent-os/backend backend grep -q "listPlatformCrons" src/services/platform-cron-registry.js 2>/dev/null \
  && docker compose exec -T -w /opt/agent-os/backend backend grep -q "/crons" src/routes/admin.js 2>/dev/null; then
  echo "    Admin platform cron control API OK"
else
  echo "    WARN: Admin cron control API missing"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Research AI trends and give me Q2 expense report" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    WARN: outdated Standup multi-intent blurb still in frontend bundle"
else
  echo "    frontend assets: Standup multi-intent blurb removed OK"
fi
if docker compose exec -T -w /opt/agent-os/backend backend grep -q "getDepartmentEfficiency" src/services/department-efficiency.js 2>/dev/null; then
  echo "    Department efficiency service deployed OK"
else
  echo "    WARN: department-efficiency.js missing"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Department" /usr/share/nginx/html/assets/*.js 2>/dev/null' \
  && docker compose exec -T frontend sh -c 'grep -Rql "efficiencyDepartments\|Department tokens this month\|All departments" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Efficiency Department tab OK"
else
  echo "    WARN: Efficiency Department tab not found in frontend JS"
fi
if docker compose exec -T -w /opt/agent-os/backend backend grep -q "resolveBrainMemberKey" src/services/agent-workflow-brain.js 2>/dev/null; then
  echo "    Brain token attribution helper deployed OK"
else
  echo "    WARN: resolveBrainMemberKey missing from agent-workflow-brain.js"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/verify-coo-agents-md.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/verify-coo-agents-md.js >/tmp/coo-agents-md-live.log 2>&1 \
    && echo "    live COO AGENTS.md is org-generated for every CEO OK" \
    || echo "    WARN: some CEO has a non-generated COO AGENTS.md (see /tmp/coo-agents-md-live.log)"
fi
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/cleanup-agents-md-backups.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/cleanup-agents-md-backups.js >/tmp/agents-md-backups.log 2>&1 \
    && echo "    workspace AGENTS.md backup cleanup OK ($(grep -c . /tmp/agents-md-backups.log) line(s))" \
    || echo "    WARN: workspace backup cleanup failed (see /tmp/agents-md-backups.log)"
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
  # Re-upload User Guide (README) + Platform Help corpus so doc edits reach every CEO's Master Data RAG.
  if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/reupload-platform-help-docs.js 2>/dev/null; then
    docker compose exec -T -w /opt/agent-os/backend backend node scripts/reupload-platform-help-docs.js >/tmp/help-reupload.log 2>&1 \
      && echo "    platform help + user guide re-upload OK" \
      || echo "    WARN: platform help re-upload failed (see /tmp/help-reupload.log)"
  fi
  # Drop duplicate/stale help docs so RAG can only retrieve the freshly uploaded versions.
  if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/heal-platform-help-docs.js 2>/dev/null; then
    docker compose exec -T -w /opt/agent-os/backend backend node scripts/heal-platform-help-docs.js >/tmp/help-heal.log 2>&1 \
      && echo "    platform help dedupe OK" \
      || echo "    WARN: platform help dedupe failed (see /tmp/help-heal.log)"
  fi
  if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/refresh-coo-workspace-docs.js 2>/dev/null; then
    docker compose exec -T -w /opt/agent-os/backend backend node scripts/refresh-coo-workspace-docs.js >/tmp/coo-docs-refresh.log 2>&1 \
      && echo "    COO workspace docs refresh OK" \
      || echo "    WARN: COO workspace docs refresh failed"
  fi
  BC=$(docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -d '{"message":"ping","agent_ids":["__deploy_smoke_no_agent__"]}' http://127.0.0.1:3001/api/broadcast || echo 000)
  echo "    broadcast auth empty-target=$BC (expect 200)"
  EFFA=$(docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${TOKEN}" http://127.0.0.1:3001/api/efficiency/agents || echo 000)
  echo "    efficiency/agents auth=$EFFA (expect 200)"
  OM=$(docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${TOKEN}" http://127.0.0.1:3001/api/org-members || echo 000)
  echo "    org-members auth=$OM (expect 200)"
  OMU=$(docker compose exec -T backend curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/org-members || echo 000)
  echo "    org-members unauth=$OMU (expect 401)"
fi

# Always re-sync WhatsApp/Slack channel routing after recreate (even when SKIP_SMOKE=1).
# Prevents openclaw.json drift: DB enabled + creds on disk but channels/bindings missing.
echo "==> agent channels (WhatsApp/Slack) sync + drift gate"
if [[ ! -f "$ROOT/deploy/scripts/vps-verify-agent-channels.sh" ]]; then
  echo "ERROR: missing deploy/scripts/vps-verify-agent-channels.sh (sync-to-vps incomplete)"
  exit 1
fi
sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-verify-agent-channels.sh" 2>/dev/null || true
if bash "$ROOT/deploy/scripts/vps-verify-agent-channels.sh"; then
  echo "    agent-channels gate OK"
else
  echo "ERROR: agent-channels gate failed — WhatsApp/Slack may be offline after this deploy"
  echo "    Fix: Dashboard → Agent channels → Enable, or re-run vps-verify-agent-channels.sh"
  # Fatal for channel drift so we do not ship a silent WhatsApp outage again.
  exit 1
fi

# MEDIA: dual-write + audio MIME (WhatsApp attach + webchat players). Run even with SKIP_SMOKE=1.
echo "==> media delivery (MEDIA: + audio MIME) gate"
if [[ -f "$ROOT/deploy/scripts/vps-verify-media-delivery.sh" ]]; then
  sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-verify-media-delivery.sh" 2>/dev/null || true
  if bash "$ROOT/deploy/scripts/vps-verify-media-delivery.sh"; then
    echo "    media-delivery gate OK"
  else
    echo "ERROR: media-delivery gate failed — WhatsApp/webchat media may still be URL-only"
    exit 1
  fi
else
  echo "ERROR: missing deploy/scripts/vps-verify-media-delivery.sh (sync-to-vps incomplete)"
  exit 1
fi

if [[ "$SKIP_SMOKE" != "1" ]]; then
  if [[ -f "$ROOT/deploy/scripts/vps-smoke-new-features.sh" ]]; then
    echo "==> new-features smoke (email_send + notify_ceo + master_data + org sync + A2A public/OAuth/async + shared notification dismiss)"
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
  if [[ -f "$ROOT/deploy/scripts/vps-smoke-openconnector.sh" ]]; then
    echo "==> OpenConnector connectors smoke"
    sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-smoke-openconnector.sh" 2>/dev/null || true
    bash "$ROOT/deploy/scripts/vps-smoke-openconnector.sh" || echo "WARN: OpenConnector smoke failed (non-fatal)"
  fi
  if [[ -f "$ROOT/deploy/scripts/vps-smoke-budgets-org-members.sh" ]]; then
    echo "==> budgets / Agent View / org leaf members smoke"
    sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-smoke-budgets-org-members.sh" 2>/dev/null || true
    bash "$ROOT/deploy/scripts/vps-smoke-budgets-org-members.sh" || echo "WARN: budgets/org-members smoke failed (non-fatal)"
  fi
  if [[ -f "$ROOT/deploy/scripts/vps-smoke-brave-byok.sh" && -n "${BRAVE_API_KEY:-}" ]]; then
    echo "==> Brave BYOK workflow smoke (Balaji)"
    sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-smoke-brave-byok.sh" 2>/dev/null || true
    bash "$ROOT/deploy/scripts/vps-smoke-brave-byok.sh" || echo "WARN: Brave BYOK smoke failed (non-fatal)"
  fi
  if [[ -f "$ROOT/deploy/scripts/vps-smoke-meta-graph-mcp.sh" && "${SKIP_PLATFORM_MCPS:-0}" != "1" ]]; then
    echo "==> Meta Graph platform MCP smoke (container + seed; no Facebook creds)"
    sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-smoke-meta-graph-mcp.sh" 2>/dev/null || true
    bash "$ROOT/deploy/scripts/vps-smoke-meta-graph-mcp.sh" || echo "WARN: Meta Graph MCP smoke failed (non-fatal)"
  fi
  if [[ -f "$ROOT/deploy/scripts/vps-verify-platform.sh" ]]; then
    echo "==> platform verify (Master Data, delegation, allowlists)"
    sed -i 's/\r$//' "$ROOT/deploy/scripts/vps-verify-platform.sh" 2>/dev/null || true
    bash "$ROOT/deploy/scripts/vps-verify-platform.sh" || echo "WARN: platform verify failed (non-fatal)"
  fi
fi

docker compose ps

# Seed inbound media summarize workflows
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/seed-inbound-media-summarize-workflow.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/seed-inbound-media-summarize-workflow.js >/tmp/inbound-media-wf.log 2>&1 \
    && echo "    inbound media summarize workflow seed OK" \
    || echo "    WARN: inbound media workflow seed failed (see /tmp/inbound-media-wf.log)"
fi

# Optional content-media workflows (per CEO): publish-social + FB comments ingest/triage (standard workflow nodes).
# Set SEED_CONTENT_MEDIA_OWNER=ceo-... in deploy/.env (or export) to re-seed after image rebuilds.
# Brains use Platform_BYOK vault when set; otherwise ollama.
if [[ -n "${SEED_CONTENT_MEDIA_OWNER:-}" && "${SKIP_CONTENT_MEDIA_SEED:-0}" != "1" ]]; then
  echo "==> Content media workflow seeds for owner=$SEED_CONTENT_MEDIA_OWNER"
  if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/seed-content-publish-social-workflow.js 2>/dev/null; then
    docker compose exec -T -w /opt/agent-os/backend -e WORKFLOW_SEED_OWNER_ID="$SEED_CONTENT_MEDIA_OWNER" backend \
      node scripts/seed-content-publish-social-workflow.js >/tmp/content-publish-social-seed.log 2>&1 \
      && echo "    content-publish-social seed OK" \
      || echo "    WARN: content-publish-social seed failed (see /tmp/content-publish-social-seed.log)"
  fi
  if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/seed-content-comments-ingest.js 2>/dev/null; then
    docker compose exec -T -w /opt/agent-os/backend -e WORKFLOW_SEED_OWNER_ID="$SEED_CONTENT_MEDIA_OWNER" backend \
      node scripts/seed-content-comments-ingest.js >/tmp/content-comments-seed.log 2>&1 \
      && echo "    content-comments-ingest / community triage seed OK" \
      || echo "    WARN: content-comments seed failed (see /tmp/content-comments-seed.log)"
  fi
fi

echo "DEPLOY_LATEST_DONE $(date -Is)"
