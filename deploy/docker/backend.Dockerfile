# Agent OS backend API
# Rebuild after: Platform Help corpus, seed scripts, content-tools allowlists, master-data,
# Kanban owner_user_id isolation (schema + kanban-user-scope + routes/tools/delegation),
# lean CEO onboard (DEFAULT_ONBOARD_AGENT_IDS / pruneSharedStandardAgentGrants),
# desktop-workflow-runner (Windows PS1 packages + optional portable Node baked at download time),
# local-ibkr-bridge (Connectors download zip + vendored IBKR gateway client),
# local-browser-worker (Connectors Browser Session package: multi-user desktop chrome, headed + persistent profile),
# monthly trading W1–W5 seeds + paper E2E / certify helpers,
# bridge account_snapshot → W3 ingest + W1 account-snapshot/latest (no VPS Gateway required),
# IBKR Summary UI (/ibkr-summary) + clear transactional APIs (ibkr-transactional-clear.js),
# bridge-order-events ingest (W3 → ibkr_order_events → learnings),
# openclaw-config-safe.js (never strip gateway.chatCompletions / tools / plugins / browser),
# agent budgets + token_usage ledger + org leaf members (org-members routes, Agent View APIs),
# verify-budgets-org-members / test-org-member-delegation-e2e / verify-agent-view-api scripts,
# tests/ (regression-full / regression-minimal + ceo-session for VPS regression).
# Image COPYs openclaw templates/skills/extensions + knowledgebase/platform-help for RAG seeding.
# Also COPYs deploy/ (ensure-openclaw-gateway-config.js used by vps-verify-openclaw-chat via backend).
# Sources MUST be UTF-8 (not UTF-16); UTF-16 .js fails Node with "Invalid regular expression".
# Scheduled goals: backend services/routes + schema; master tick SCHEDULED_GOALS_CRON in compose;
# help docs 19/28 must ship in platform-help COPY; seed tools in seed-content-tools-meta.js.
# Also: public VR routes, speech STT/TTS APIs + COO content tools speech_tts/speech_stt,
# agent channels, optional-voice (whisper+piper),
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
RUN cd backend && npm ci --omit=dev

COPY backend ./backend
COPY scripts ./scripts
COPY tests ./tests
COPY openclaw-workspace-templates ./openclaw-workspace-templates
COPY openclaw-skills ./openclaw-skills
COPY openclaw-extensions ./openclaw-extensions
COPY deploy ./deploy
# Seeded as Master Data "Flolah User Guide" for every CEO (register + startup backfill; protected from purge/delete)
COPY README.md ./README.md
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
