# Agent OS backend API
# Rebuild after: Platform Help corpus, seed scripts, content-tools allowlists, master-data,
# Kanban owner_user_id isolation (schema + kanban-user-scope + routes/tools/delegation),
# lean CEO onboard (DEFAULT_ONBOARD_AGENT_IDS / pruneSharedStandardAgentGrants),
# desktop-workflow-runner (Windows PS1 packages + optional portable Node baked at download time),
# local-ibkr-bridge and IBKRNew event bridge (owner-scoped Connectors download packages),
# IBKRNew0 source blueprints + six OpenClaw agent templates + strategy skill,
# local-browser-worker (Connectors Browser Session package: multi-user desktop chrome, headed + persistent profile),
# flolah-chrome-extension (MV3 owner-scoped normal-Chrome executor package),
# monthly trading W1–W5 seeds + paper E2E / certify helpers,
# bridge poll + ingest /api/ibkr-trading/local-bridge-webhook (W3 secret; W3 graph on EOD) → W1 latest cache,
# IBKR Summary UI (/ibkr-summary) + clear transactional APIs (ibkr-transactional-clear.js),
# bridge-order-events ingest (ingest API → ibkr_order_events; W3 journal/notify on EOD),
# openclaw-config-safe.js (never strip gateway.chatCompletions / tools / plugins / browser),
# agent budgets + token_usage ledger + org leaf members (org-members routes, Agent View APIs),
# verify-budgets-org-members / test-org-member-delegation-e2e / verify-agent-view-api scripts,
# tests/ (regression-full / regression-minimal + ceo-session for VPS regression).
# Image COPYs openclaw templates/skills/extensions + knowledgebase/platform-help for RAG seeding.
# Also COPYs deploy/ (ensure-openclaw-gateway-config.js used by vps-verify-openclaw-chat via backend).
# Sources MUST be UTF-8 (not UTF-16); UTF-16 .js fails Node with "Invalid regular expression".
# Scheduled goals: backend services/routes + schema; master tick SCHEDULED_GOALS_CRON in compose;
# GOAL_PLAN_* / SCHEDULED_GOAL_CHAT_TIMEOUT_MS / WORKFLOW_TERMINAL_WATCH_CRON / TOOL_API_RATE_LIMIT_RESET_CRON also in compose backend-env;
# help docs 11/19/28/42/48 must ship in platform-help COPY; seed tools in seed-content-tools-meta.js.
# ISO 3166 country/region on Profile/Register/Company setup (iso-3166 dep; platform_users.country).
# Also: public VR routes, speech STT/TTS APIs + COO content tools speech_tts/speech_stt,
# agent channels (Slack/WhatsApp/Voice), optional-voice (whisper+piper), Voice Realtime sessions,
# platform MCP OAuth (mcp-oauth tables) + Meta Graph seed (seed-meta-graph-mcp.js) +
# Connectors → MCPs (mcp-integrations routes).
FROM node:22-bookworm-slim

# python3: custom workflow script sandbox (Python); make/g++: better-sqlite3 native build
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 python3-minimal \
    make g++ ca-certificates curl zip ffmpeg \
    fonts-dejavu-core \
    librsvg2-bin \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/agent-os

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund

COPY backend ./backend
RUN cd backend/ibkrnew-event-bridge && npm ci --omit=dev --no-audit --no-fund
COPY scripts ./scripts
COPY tests ./tests
COPY openclaw-workspace-templates ./openclaw-workspace-templates
COPY openclaw-skills ./openclaw-skills
COPY .cursor/skills/ibkrnew-trade-strategy ./openclaw-skills/ibkrnew-trade-strategy
COPY openclaw-extensions ./openclaw-extensions
COPY deploy ./deploy
# Seeded as Master Data "Flolah User Guide" for every CEO (register + startup backfill; protected from purge/delete)
COPY README.md ./README.md
COPY knowledgebase/PROJECT.md ./knowledgebase/PROJECT.md
COPY LICENSE ./LICENSE
COPY NOTICE ./NOTICE
COPY THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
# Platform Help corpus → Master Data RAG (Platform Help agent / master_data_rag; protected from purge/delete)
COPY knowledgebase/platform-help ./knowledgebase/platform-help
COPY knowledgebase/video-tours ./knowledgebase/video-tours

WORKDIR /opt/agent-os/backend

ENV NODE_ENV=production
ENV HOME=/root
ENV OPENCLAW_DIR=/root/.openclaw
ENV OPENCLAW_CONFIG_PATH=/root/.openclaw/openclaw.json
ENV AGENT_OS_DATA_DIR=/data/agent-os
ENV CUSTOM_SCRIPT_PYTHON=python3
ENV CUSTOM_SCRIPT_NODE=node
ENV CUSTOM_SCRIPT_LLM_REVIEW=1
ENV CUSTOM_SCRIPT_LLM_REVIEW_REQUIRED=1
ENV CUSTOM_SCRIPT_LLM_REVIEW_MAX_TOKENS=768

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/health || exit 1

CMD ["node", "src/index.js"]
