#!/usr/bin/env bash
# Build, bootstrap, and start Agent OS (Docker Compose or Podman Compose).
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${DEPLOY_DIR}"

COMPOSE="${COMPOSE_CMD:-docker compose}"
if command -v podman-compose >/dev/null 2>&1 && [[ "${USE_PODMAN:-0}" == "1" ]]; then
  COMPOSE="podman-compose"
fi

if [[ ! -f .env ]]; then
  echo "Copy .env.example to .env and edit secrets first." >&2
  exit 1
fi

echo "Ensuring TOOLS_API_KEY + AGENT_OS_INTERNAL_TOKEN + TOOLS_BASE_URL in deploy/.env..."
node "${DEPLOY_DIR}/../scripts/ensure-deploy-secrets.js" --env-file "${DEPLOY_DIR}/.env"

if [[ -f scripts/ensure-opensearch-env.sh ]]; then
  sed -i 's/\r$//' scripts/ensure-opensearch-env.sh 2>/dev/null || true
  bash scripts/ensure-opensearch-env.sh "${DEPLOY_DIR}/.env" || true
fi
if [[ -f scripts/ensure-cron-env.sh ]]; then
  sed -i 's/\r$//' scripts/ensure-cron-env.sh 2>/dev/null || true
  bash scripts/ensure-cron-env.sh "${DEPLOY_DIR}/.env" || true
fi
if [[ -f scripts/ensure-voice-env.sh ]]; then
  sed -i 's/\r$//' scripts/ensure-voice-env.sh 2>/dev/null || true
  bash scripts/ensure-voice-env.sh "${DEPLOY_DIR}/.env" || true
fi

# OpenSearch requires elevated mmap counts (Linux hosts / VPS).
if command -v sysctl >/dev/null 2>&1; then
  cur="$(sysctl -n vm.max_map_count 2>/dev/null || echo 0)"
  if [[ "${cur:-0}" -lt 262144 ]]; then
    echo "Setting vm.max_map_count=262144 (was ${cur:-0}) for OpenSearch..."
    if [[ "$(id -u)" -eq 0 ]]; then
      sysctl -w vm.max_map_count=262144 >/dev/null || true
    elif command -v sudo >/dev/null 2>&1; then
      sudo sysctl -w vm.max_map_count=262144 >/dev/null || true
    else
      echo "WARN: cannot raise vm.max_map_count — OpenSearch may fail to start. Run as root: sysctl -w vm.max_map_count=262144" >&2
    fi
  fi
fi

if [[ ! -f nginx/certs/fullchain.pem ]]; then
  echo "TLS certs missing — generating dev self-signed certs (apex + login SANs)..."
  bash scripts/generate-dev-certs.sh
fi

if [[ -d static/flolah-home ]]; then
  chmod -R a+rX static/flolah-home 2>/dev/null || true
else
  echo "WARN: static/flolah-home missing — apex marketing page will 404 until tree is present" >&2
fi

echo "Building images..."
${COMPOSE} build

echo "Running one-shot bootstrap (init profile)..."
${COMPOSE} --profile init run --rm init

echo "Starting stack (includes OpenSearch + Dashboards)..."
${COMPOSE} up -d "$@"
# Ensure document RAG services even if a custom service list was passed.
${COMPOSE} up -d opensearch opensearch-dashboards || echo "WARN: OpenSearch up failed"
# Optional: wait for backend and register OpenConnector MCP when URL is configured.
if grep -qE '^OPENCONNECTOR_MCP_URL=.+' .env 2>/dev/null; then
  OC_URL="$(grep -E '^OPENCONNECTOR_MCP_URL=' .env | head -1 | cut -d= -f2-)"
  if [[ -n "${OC_URL}" ]]; then
    echo "Waiting for backend health before OpenConnector MCP seed..."
    for i in $(seq 1 60); do
      if ${COMPOSE} exec -T backend curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
        break
      fi
      sleep 2
    done
    echo "Seeding OpenConnector MCP (${OC_URL})..."
    ${COMPOSE} exec -T backend node scripts/seed-openconnector-mcp.js || \
      echo "OpenConnector seed skipped/failed — start optional-openconnector or fix OPENCONNECTOR_MCP_URL, then re-run seed."
  fi
fi

echo ""
echo "Stack started. Check: ${COMPOSE} ps"
echo "Health: curl -k https://localhost/health  (or http://localhost:8080 with docker-compose.dev.yml)"
echo "Prod hosts: marketing https://flolah.cloud  app/login https://login.flolah.cloud"
echo "  (TLS multi-SAN after DNS: bash scripts/vps-expand-login-cert.sh — acme.sh TLS-ALPN on :443)"
echo "APIs (via nginx /api): master-data, feedback, openconnector, email-inbound, BYOK LLM,"
echo "  email_send (/api/tools/email-send), notify_ceo (/api/tools/notify-ceo),"
echo "  broadcast (/api/broadcast) — UI /broadcast; CEO-scoped so notify_ceo works,"
echo "  org sync (/api/agents/org/sync) — My Org: Resync ORG.md & AGENTS.md,"
echo "  master_data_* content tools (docs → OpenSearch), Admin Documents RAG,"
echo "  OpenSearch Dashboards BFF /opensearch/ (admin cookie; no host :9200/:5601),"
echo "  shared notification dismiss (NotificationProvider),"
echo "  notification bell shows datetime; CEO Policies (/policies) → POLICY.md + Brain,"
echo "  deploy verify smokes self-clean CEO UI,"
echo "  /standups/notifications/dismiss[-all] + /platform-notifications/read[-all],"
echo "  AgentExchange (/api/agent-exchange),"
echo "  workflow A2A (/api/a2a/:publishId + card; secured: /oauth/token client credentials),"
echo "  public VR (/api/public/vr/:slug), agent channels (/api/agent-channels),"
echo "  WhatsApp groupPolicy=disabled by default (sync rewrites openclaw.json),"
echo "  CEO home chat / + My Org /org, Profile role_title,"
echo "  free speech (/api/speech/stt|tts) via optional-voice (ensure-voice-env.sh)"
echo "OpenSearch smoke: docker compose exec -T backend node scripts/test-opensearch-rag-smoke.js"
echo "Post-deploy smoke (on VPS): bash scripts/vps-smoke-new-features.sh"
echo "Broadcast notify smoke: bash scripts/vps-smoke-broadcast-notify.sh"
echo "Platform verify (on VPS): bash scripts/vps-verify-platform.sh"
echo "Clean rebuild if UI markers missing: NO_CACHE=1 bash scripts/vps-deploy-latest.sh"
