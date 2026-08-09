# Agent OS — Container deployment

Production stack for Agent OS: **nginx**, **frontend**, **backend**, **OpenClaw gateway**, **OpenSearch** (+ Dashboards BFF), plus optional **init**, **MCP**, **OpenConnector**, **Ollama**, and **browser-login** services.

Works with **Docker Compose** and **Podman Compose** on CentOS/RHEL, Ubuntu (Hostinger VPS), and other Linux hosts.

## Containers

| Service | Required | Port (host) | Purpose |
|---------|----------|-------------|---------|
| `nginx` | Yes | 80, 443 | TLS; `flolah.cloud` → marketing static; `login.flolah.cloud` → SPA + `/api` → backend |
| `frontend` | Yes | internal | React SPA (Vite build) on login subdomain |
| `backend` | Yes | internal | API, cron, workflows, SQLite, master-data, feedback, BYOK |
| `openclaw` | Yes | internal | Gateway :18789, browser tool, skills/plugins |
| `init` | First run | — | One-shot bootstrap (`--profile init`) |
| `mcp-random-sse` | Optional | internal | Dev MCP + SSE test server (`optional-mcp`) |
| `brave-search-mcp` | Optional | internal | Platform Brave Search MCP BYOK (`optional-brave-mcp`) |
| `meta-graph-mcp` | Optional | internal | Platform Meta Graph MCP for Facebook/IG (`optional-meta-graph-mcp`) |
| `opensearch` | Required | internal `:9200` only | Document meta + RAG search (per-user + platform indices) |
| `opensearch-dashboards` | Required | internal `:5601` only | Admin Dashboards via `/opensearch/` BFF |
| `openconnector` | Optional | internal | Real OpenConnector runtime, `:3000` (`optional-openconnector`) |
| `openconnector-mcp-mock` | Optional | internal | OpenConnector MCP mock, `:3105` (`optional-openconnector-mock`) |
| `ollama` | Optional | internal | Local LLM fallback for OpenClaw / BYOK |
| `novnc` | Optional | 6080 | Desktop for manual job-portal login |

## Volumes (persist)

| Volume | Mount | Contents |
|--------|-------|----------|
| `agent_os_data` | backend `/data/agent-os` | SQLite (`agent-os.db`) — master-data, feedback, user LLM settings, **Kanban `owner_user_id`**, standups/delegation owners, **platform agent workspace templates** |
| `openclaw_home` | backend + openclaw `/root/.openclaw` | `openclaw.json`, workspaces, browser profile, media, sessions |
| `workflow_fs` | backend `/data/workflow-fs` | Filesystem workflow node roots (`WORKFLOW_FS_ROOTS`) |
| `opensearch_data` | opensearch `/usr/share/opensearch/data` | Document meta + search indices |
| `openconnector_data` | openconnector `/app/data` | OpenConnector runtime DB + OAuth tokens (`optional-openconnector`) |
| `ollama_data` | ollama | Local models (optional profile) |

## OpenClaw feature parity (Docker init vs local setup)

The `init` container runs `setup-openclaw-from-scratch.sh --docker`, which matches (and extends) the Windows `setup-openclaw-from-scratch.ps1`:

| Feature | Local / Windows | Docker init |
|---------|-----------------|-------------|
| Skills: agent-send, agent-os-content-tools | ✓ | ✓ |
| Extensions: content-tools + bootstrap-watcher | partial (PS: content-tools only) | ✓ both |
| `openclaw.json` agents (Bala, COO, Workflow Builder, …) | ✓ | ✓ |
| Job Applicant agents + job tools | manual (`setup-job-applicant-agents.js`) | ✓ default |
| Content tools plugin + `baseUrl` → backend | manual env | ✓ `http://backend:3001` |
| Content tools plugin `apiKey` ↔ backend `TOOLS_API_KEY` | `ensure-tools-api-key.js` | ✓ init via `configure-openclaw-docker.js` |
| Gateway token auth | manual `.env` | ✓ from `OPENCLAW_GATEWAY_TOKEN` |
| Browser tool + Playwright Chromium | manual PS script | ✓ |
| `browser.enabled` + dedicated **`browser-cdp`** agent (`alsoAllow: browser`, no global `tools.allow` browser) | `apply-openclaw-agents-config.js` | ✓ `configure-openclaw-docker.js` on every openclaw start |
| `browse_*` content tools seeded + default agent grants | backend startup | ✓ `seed-browser-session-tools.js` |
| Browser TOOLS.md / AGENT-OS-OPS recipe vs autonomous | sync / templates | ✓ workspace templates |

| Session visibility (`tools.sessions.visibility`) | manual one-off | ✓ `agent` |
| Ollama fallback provider | ✓ | ✓ (use `optional-ollama` profile) |
| Hot-reload workspace MD (bootstrap watcher) | ✓ | ✓ (includes `AGENT-OS-OPS.md`) |
| Platform agent workspace templates (Admin + CEO apply/publish) | ✓ | ✓ (DB table `platform_agent_workspace_templates`) |
| Custom workflow scripts (Python/JS sandbox) | ✓ | ✓ (`python3` in backend image) |
| Per-agent tool grants / allowlists | backend startup sync | ✓ backend startup |
| Master-data / feedback / BYOK LLM | ✓ (schema on startup) | ✓ rebuild backend image; API Keys **Reseed BYOK keys** (`POST /api/user-api-keys/reseed`); home KPIs/search `GET /api/home/*`; profile/agent avatars; Flolah SEO meta on SPA |
| OpenConnector MCP registration | `seed-openconnector-mcp.js` | ✓ post-up when `OPENCONNECTOR_MCP_URL` set |

Verify after init:

```bash
docker compose --profile init run --rm init
# or against running volume:
docker compose run --rm openclaw node deploy/scripts/verify-openclaw-parity.js
```

Browser Session redeploy checklist: `browser.enabled`, agent `browser-cdp` (or `BROWSER_TASK_CDP_AGENT_ID`), global `tools.allow` must not contain `browser`, backend seeds `browse_recipe_run`. See `knowledgebase/CLIENT-BROWSER-SESSION.md`.


Skip Job Applicant in init: add `--no-job-applicant` to the bootstrap command in `openclaw-entrypoint.sh` or run init with a custom command.

## Quick start

```bash
cd agent-os/deploy
cp .env.example .env
# Edit: AGENT_OS_PUBLIC_URL, OPENCLAW_GATEWAY_TOKEN, OPENAI_API_KEY, admin password
# up.sh auto-fills TOOLS_API_KEY + AGENT_OS_INTERNAL_TOKEN + USER_API_KEYS_KEK if empty/placeholder
# up.sh also runs ensure-opensearch-env.sh + raises vm.max_map_count for OpenSearch

./scripts/generate-dev-certs.sh agent-os.example.com   # or use real certs in nginx/certs/

# Bootstrap + build + start
./scripts/up.sh

# Or step by step:
docker compose build
docker compose --profile init run --rm init
docker compose up -d
```

**Dev (HTTP only, no TLS):**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
# UI: http://localhost:8080
```

## Bootstrap script

`scripts/setup-openclaw-from-scratch.sh` (repo root) is the Linux/bash equivalent of `setup-openclaw-from-scratch.ps1`.

It runs inside the **`init`** container (or on bare metal) and:

1. `openclaw setup` (if no config)
2. Seeds SQLite (`seed-all.js`, `seed-expenses.js`)
3. Installs skills + extensions
4. Writes `openclaw.json` (agents, plugins, browser, gateway)
5. Applies Docker overrides (`configure-openclaw-docker.js`) — gateway token, plugin `baseUrl`, plugin `apiKey`
6. Workspace templates + COO AGENTS.md + session dirs
7. Optional Playwright Chromium (`--install-browser`)

Re-run after upgrades that change agents/skills:

```bash
docker compose --profile init run --rm init
docker compose restart openclaw backend
```

**Routine image upgrades** (backend + OpenClaw plugins/fixes): a full init is usually **not** required. The OpenClaw gateway entrypoint runs `scripts/sync-openclaw-extensions.js` and `configure-openclaw-docker.js` on every start, so rebuilt images refresh volume-mounted extensions and plugin env config automatically:

```bash
docker compose build backend openclaw
docker compose up -d backend openclaw
docker compose exec openclaw node deploy/scripts/verify-openclaw-parity.js
```

Ensure `TOOLS_BASE_URL=http://127.0.0.1:3001` in `.env` (see `.env.example`) so backend tool self-invoke does not use public HTTPS. For VPS **IP whitelists** (A2A, desktop package, browser worker, IBKR bridge webhooks), see **[VPS client IP overlay](#vps-client-ip-overlay-a2a-ip-policy)** (`COMPOSE_FILE` includes `docker-compose.vps-client-ip.yml`). Central UI: **Settings → IP Whitelists** (`knowledgebase/platform-help/33-ip-whitelists.md`). **Browser Session package** (local worker zip) is built into the backend image from ackend/local-browser-worker/ (headed + persistent profile defaults). Package token inventory: **Settings → Tokens management** (`/settings/tokens`, `34-tokens-management.md`). API vault: **Settings → API Keys**.

## Platform MCPs (Brave Search + Meta Graph + Business Core CRM/ERP)

`deploy/scripts/up.sh` and `vps-deploy-latest.sh` call **`scripts/ensure-platform-mcps.sh`** (skip with `SKIP_PLATFORM_MCPS=1`):

1. Ensures `BRAVE_MCP_URL` / `META_GRAPH_MCP_URL` / `BUSINESS_CORE_MCP_URL` in `deploy/.env`.
2. Builds/starts Compose profiles **`optional-brave-mcp`**, **`optional-meta-graph-mcp`**, and **`optional-business-core-mcp`**.
3. Seeds registry rows **`mcp-brave-search`**, **`mcp-meta-graph`**, **`mcp-flolah-crm`**, **`mcp-flolah-erp`** (`is_platform=1`) and default Meta OAuth config for **Connectors → MCPs**.

Business Core MCP proxies owner-scoped `crm_*` / `erp_*` content tools (`TOOLS_API_KEY` + `X-Ceo-User-Id`). Prefab **Maker/Checker** AI employees are provisioned when Profile selects Twenty/ERPNext — not when MCP starts. Docs: `knowledgebase/platform-help/32-business-core-crm-erp.md`, `deploy/business-core/README.md`.

### OAuth credentials model (canonical — not a VPS hotfix)

| Layer | Storage | Who |
|-------|---------|-----|
| **Platform App** (default) | `mcp_oauth_configs` where `owner_user_id = ''` (or `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` env used when seeding/UI empty) | Admin / operator |
| **CEO App override** (optional) | Same table, `owner_user_id = <ceo-id>` — App ID, secret, scopes | Each CEO via Connectors → MCPs **App ID / secret override** |
| **Access token** | `mcp_oauth_connections` + vault refs | Per CEO after **Connect with OAuth** |

Resolve order: CEO override → platform row. Encrypt client secrets / vault tokens with **`USER_API_KEYS_KEK`** (required; `up.sh` generates if empty). Prefix for encrypted app secrets: `enc:g1:`.

APIs (backend, post-login entitlements):

- Admin platform config: `PUT /api/integrations/mcp/:id/oauth/config`
- CEO override: `PUT` / `DELETE /api/integrations/mcp/:id/oauth/override`
- OAuth start/callback: existing MCP OAuth routes; public callback `GET /api/integrations/mcp/oauth/callback`

Manual:

```bash
cd deploy
docker compose --env-file .env --profile optional-meta-graph-mcp up -d --build meta-graph-mcp
docker compose exec backend node scripts/seed-meta-graph-mcp.js
bash scripts/vps-smoke-meta-graph-mcp.sh
```

Operator env (Meta app credentials for platform default OAuth):

```bash
# FACEBOOK_APP_ID=...
# FACEBOOK_APP_SECRET=...
META_GRAPH_MCP_URL=http://meta-graph-mcp:8081/mcp
# MCP_OAUTH_CALLBACK_URL=https://login.example.com/api/integrations/mcp/oauth/callback
# USER_API_KEYS_KEK=...   # required for encrypted App secrets + vaulted tokens
# Optional: re-seed publish + comments workflows for one CEO after deploy
# SEED_CONTENT_MEDIA_OWNER=ceo-...
```

Guides: MCP OAuth setup `knowledgebase/platform-help/31-mcp-connectors-oauth.md`; content ops `30-content-creator-ops.md`; OpenConnector (separate) `16-connectors-openconnector.md` + `OPENCONNECTOR-WEBHOOKS.md`.

## Environment & LLM secrets

All secrets live in **`deploy/.env`** (gitignored). Compose injects them as **runtime environment variables** — they are **not** baked into images. At init, **`OPENCLAW_GATEWAY_TOKEN`** and **`TOOLS_API_KEY`** are also written into `openclaw.json` (gateway auth + content-tools plugin).

### Shared keys: backend ↔ OpenClaw

| Key | Backend | OpenClaw |
|-----|---------|----------|
| `OPENCLAW_GATEWAY_TOKEN` | `OPENCLAW_GATEWAY_TOKEN` env | `gateway.auth.token` in openclaw.json; required for Agent Chat + chatCompletions endpoint (keep in sync via configure/ensure) |
| `TOOLS_API_KEY` | `TOOLS_API_KEY` env | `plugins.entries['agent-os-content-tools'].config.apiKey` |
| `TOOLS_BASE_URL` | backend tool self-dispatch (default `http://127.0.0.1:3001`) | — (backend-only) |
| `AGENT_OS_INTERNAL_TOKEN` | workflow runner / tools / cron | — (backend-only; must be stable) |

Both OpenClaw plugin keys must match or COO/content-tools calls fail with 401. Without a stable `AGENT_OS_INTERNAL_TOKEN`, workflow/internal auth breaks after every backend restart.

**First deploy / auto-generate:**

```bash
cd agent-os/deploy
cp .env.example .env
# up.sh runs this before init:
node ../scripts/ensure-deploy-secrets.js --env-file .env
docker compose --profile init run --rm init
```

**Local dev (non-Docker):**

```bash
cd agent-os
node scripts/ensure-tools-api-key.js
# syncs backend/.env + ~/.openclaw/openclaw.json
# Also set AGENT_OS_INTERNAL_TOKEN in backend/.env for stable workflow auth
```

**Rotate or fix a mismatch:**

```bash
# 1. Set the same value in deploy/.env (or re-run ensure-deploy-secrets.js)
# 2. Re-apply openclaw.json plugin config:
docker compose run --rm openclaw node deploy/scripts/configure-openclaw-docker.js
# 3. Recreate services so env is picked up:
docker compose up -d --force-recreate openclaw backend
```

### OpenClaw gateway (`openclaw` container)

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | Default OpenAI-compatible provider |
| `OPENAI_PRIMARY_*`, `OPENAI_SECONDARY_*` | Aliases / fallback endpoint |
| `ANTHROPIC_API_KEY` | Claude models (e.g. `anthropic/claude-opus-4-6`) |
| `OPENCLAW_MODEL_PRIMARY` | Default agent model slug (also in `openclaw.json` at init) |
| `OPENCLAW_ENABLE_OLLAMA_FALLBACK` | `0` clears silent Ollama fallbacks (default); `1` to enable |
| `OLLAMA_BASE_URL`, `OLLAMA_API_KEY` | Local Ollama fallback |
| `OPENROUTER_*` | If using OpenRouter-backed models in OpenClaw config |

### Backend (`backend` container)

Gets the same gateway LLM vars plus:

| Variable | Purpose |
|----------|---------|
| `AGENT_OS_INTERNAL_TOKEN` | Workflow runner, tools proxy, cron-callback (required in production). Query `internal_token` is only accepted on `/api/standups/cron-callback`; elsewhere use `x-agent-os-internal`. |
| `PLATFORM_LOG_LEVEL` | Backend request/error logging: `off`, `error`, or `info` (default). Secrets are redacted at every level — API keys, bearer tokens, `Authorization`, passwords and MFA codes never reach the log, and API Keys / auth routes log method + route only. |
| `COO_STATUS_CHECKER_CRON` | Daily COO status digest per enabled CEO → standup post + HTML email (default `0 9 * * *`). Manual: **Run status checker** on the Dashboard. |
| `SCHEDULED_GOALS_CRON` | Master tick for **Scheduled goals** (default `* * * * *`). Cadences: **hourly** \| daily \| weekdays \| weekly. Fires only **active** CEO prompts; paused/deleted stay off across restarts. UI: `/scheduled-goals` create/**edit**; COO tools `scheduled_goal_*`. Docs: platform-help **28**. Verify: `vps-verify-scheduled-goals.sh`. |
| `DATA_RETENTION_CRON` | Nightly retention purge per enabled CEO (default `15 3 * * *`), using each CEO's Profile **Data persistence** window: aged chats, standup messages, workflow runs, **and** Content Explorer uploaded/generated media (hard delete). Manual: **Purge aged data now**. |
| `STANDUP_SCHEDULE_CRON`, `STANDUP_CRON_SCHEDULE`, `DELEGATION_CRON_SCHEDULE`, `AGENT_WORKFLOW_SCHEDULER_CRON`, `JOB_PIPELINE_CRON_SCHEDULE`, `KANBAN_ORPHAN_WATCHER_CRON` | Remaining platform timers. All optional — every job has a code default; `deploy/scripts/ensure-cron-env.sh` keeps a commented reference block in `deploy/.env`. Admins can pause/resume/run each one at `/admin/crons`. |
| `TOOLS_API_KEY` | OpenClaw content-tools ↔ backend (required in production; must match plugin `apiKey`) |
| `OPENAI_COO_MODEL`, `OPENAI_INTENT_MODEL` | COO / intent classifier |
| `REPLICATE_API_TOKEN` | Video generation content tool |
| `OPENROUTER_*` | Dev/test scripts; Brain nodes still use per-node keys |
| `CUSTOM_SCRIPT_*` | Python/JS workflow script sandbox (`python3` in image); includes LLM security review at registration |
| `WORKFLOW_SMTP_*` | Send Email workflow task, `email_send` content tool (incl. ICS invites), MFA email OTP. Use a verified sender domain with your SMTP provider. |
| `WORKFLOW_TEST_EMAIL_TO` | Optional recipient for SMTP smoke scripts (`test-email-send-tool.js`) |
| `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` | Optional DeepSeek override. Brain `deepseek` defaults to cloud V4 (`https://api.deepseek.com/v1`, `deepseek-v4-flash`) with per-node API key; set these to Ollama for local. Profile BYOK `deepseek` still uses local Ollama when pointed here. |
| `BRAVE_API_KEY` | Agent content tool **`brave_web_search`** when Profile is Platform default. Also test/workflow run input for Brave MCP demos. **Not** injected into the Brave MCP container (that stays header BYOK). Vault **`BRAVE_SEARCH_BYOK`** for non-platform Profiles. Profile `optional-brave-mcp`. |
| `MFA_MODE`, `AGENT_OS_REQUIRE_MFA`, `AGENT_OS_DISABLE_MFA` | Platform MFA defaults (production: `MFA_MODE=TOTP`, `AGENT_OS_REQUIRE_MFA=1`) |
| `EMAIL_INBOUND_WEBHOOK_SECRET` | Optional platform secret for email inbound webhooks |
| `OPENCONNECTOR_URL` | Base URL of the OpenConnector runtime (e.g. `http://openconnector:3000`). Enables Connector workflow nodes + User Profile auto-provision. |
| `OPENCONNECTOR_ADMIN_TOKEN` | Admin token for the OpenConnector runtime (bootstraps user runtime tokens) |
| `OPENCONNECTOR_ENCRYPTION_KEY` | Encryption key for OpenConnector token store |
| `OPENCONNECTOR_MCP_*` | OpenConnector MCP URL / bearer / transport (Brain+MCP tool-calling) |
| `OPENSEARCH_ENABLED` | `1` (default) to use OpenSearch for document meta + RAG; `0` disables document ops (tables still work) |
| `OPENSEARCH_URL` | Internal URL only: `http://opensearch:9200` (never publish host ports) |
| `OPENSEARCH_DASHBOARDS_URL` | Internal Dashboards: `http://opensearch-dashboards:5601`; browser uses `/opensearch/` BFF |
| `OPENSEARCH_USERNAME` / `OPENSEARCH_PASSWORD` | Optional basic auth if you enable the security plugin later (compose default: security disabled, network isolation) |
| `OPENSEARCH_EMBEDDINGS_ENABLED` | `1` = hybrid BM25+kNN via **local Qwen** (default). `0` = BM25 only |
| `OPENSEARCH_EMBEDDING_BASE_URL` | Embeddings HTTP base (default `http://embeddings:8080/v1`) — **not** OpenAI cloud |
| `OPENSEARCH_EMBEDDING_MODEL` / `OPENSEARCH_EMBEDDING_DIMS` | Default `Qwen/Qwen3-Embedding-0.6B` / `1024` |
| `OPENSEARCH_EMBEDDING_API_KEY` | Optional bearer (default `local`; local server does not require a real key) |
| `OPENSEARCH_JAVA_OPTS` | Heap for OpenSearch container (default `-Xms512m -Xmx512m`) |
| `WORKFLOW_FS_ROOTS` | Allowed roots for filesystem workflow nodes (default `/data/workflow-fs`) |
| `WORKFLOW_CERTIFY_USE_LLM_CHECKER` | Autonomous Maker/Checker certify: `0`/unset = LLM Checker **OFF** (default; deterministic Checker always runs). `1` = enable soft LLM Checker (secondary model unless `WORKFLOW_CERTIFY_CHECKER_MODEL` set) |
| `WORKFLOW_CERTIFY_MAX_ATTEMPTS`, `WORKFLOW_CERTIFY_*_MODEL`, `WORKFLOW_CERTIFY_*_MS` | Optional certify budgets / model overrides (see `.env.example`) |
| `A2A_ACCESS_TOKEN_TTL_SEC`, `A2A_SYNC_TIMEOUT_MS`, `A2A_ASYNC_WATCH_TIMEOUT_MS`, `A2A_CALLBACK_TIMEOUT_MS` | Published workflow A2A: OAuth token TTL, sync hold, async background watch, outbound callback POST timeout |
| `LEARNINGS_FULL_REBUILD_DAYS`, `ORDER_LEARNINGS_FULL_REBUILD_DAYS`, `BRAIN_HISTORY_FULL_REBUILD_DAYS` | Full rebuild cadence for `learnings_summary` / `ibkr_order_learnings` / `brain_history` summary caches (default 7 days) |

**Workflow Brain nodes:** published workflows require API keys **on each Brain node** in the editor — platform `.env` keys are not used at run time (see `backend/.env.example`). User BYOK keys live in SQLite (User Profile). DeepSeek/OpenRouter Brain nodes also support **Thinking mode** / **Thinking effort** in the editor.

### Critical production values

- `AGENT_OS_PUBLIC_URL` — public HTTPS URL (workflow webhooks, email-inbound, callbacks)
- `OPENCLAW_GATEWAY_TOKEN` — must match `gateway.auth.token` in openclaw.json (set by init)
- `TOOLS_API_KEY` — must match `plugins.entries['agent-os-content-tools'].config.apiKey` (set by init)
- `AGENT_OS_INTERNAL_TOKEN` — stable secret (auto-generated by `up.sh` / `ensure-deploy-secrets.js`)
- `USER_API_KEYS_KEK` — wraps optional API Key vault encryption phrases (generate: `openssl rand -hex 32`). Also encrypts **MCP OAuth App client secrets** (admin + CEO override) and related vaulted OAuth tokens. Non-platform Profiles auto-seed unset vault slots (`Platform_BYOK`, `Replicate_BYOK`, `BRAVE_SEARCH_BYOK`, `elevenlabs-key`); see platform-help **15** and **31**.
- `VITE_API_URL=/api` — frontend calls nginx-relative API path
- Do **not** publish OpenClaw port 18789, OpenSearch `:9200`, or Dashboards `:5601` to the host
- Linux hosts: `vm.max_map_count=262144` (applied by `up.sh` / `vps-deploy-latest.sh`; persist in `/etc/sysctl.conf`)

### OpenSearch document RAG (required for Master Data documents)

Compose always starts `opensearch` + `opensearch-dashboards` (internal network only). Backend waits for cluster health, seeds **platform** help into `aos-docs-*-platform`, and migrates legacy SQLite chunks when present.

| Surface | Index scope |
|---------|-------------|
| CEO Master Data → Documents / RAG | `aos-docs-meta-{fp}` + `aos-docs-search-{fp}` |
| Admin → Documents RAG | platform indices |
| Agent `platformhelp` + `master_data_rag` | platform indices (no OpenClaw config change) |
| COO / other agents `master_data_rag` | calling CEO’s user indices |
| Admin OpenSearch console | `/opensearch/` → backend BFF (admin session cookie) |

Fresh machine checklist (after `cp .env.example .env`):

```bash
# From deploy/
bash scripts/ensure-opensearch-env.sh .env   # also run by up.sh / vps-deploy-latest.sh
bash scripts/ensure-embeddings-env.sh .env   # local Qwen (optional-embeddings); SKIP_EMBEDDINGS=1 to skip
# Persist mmap (once per host):
#   echo 'vm.max_map_count=262144' | sudo tee -a /etc/sysctl.conf && sudo sysctl -p
./scripts/up.sh
docker compose exec -T backend node scripts/test-opensearch-rag-smoke.js
# Optional entitlement e2e:
# docker compose exec -T -e AGENT_OS_API_URL=http://127.0.0.1:3001 backend node scripts/test-opensearch-agent-rag-e2e.js
```

After changing OpenSearch env, recreate backend (+ nginx if proxy paths changed):

```bash
docker compose up -d opensearch opensearch-dashboards
docker compose --profile optional-embeddings up -d --build embeddings
docker compose up -d --force-recreate backend nginx
```

Local Qwen embeddings: `bash deploy/scripts/ensure-embeddings-env.sh` starts Compose profile `optional-embeddings` (`Qwen/Qwen3-Embedding-0.6B`, 1024-d, no OpenAI keys). Backend uses `OPENSEARCH_EMBEDDING_BASE_URL=http://embeddings:8080/v1`. After first enable or dim change, **Reindex all** in Master Data / Admin Documents RAG (existing OpenSearch indices may still be 1536-d from older OpenAI config — those search indices are recreated on next index when dims mismatch).
After changing keys in `.env`:

```bash
docker compose run --rm openclaw node deploy/scripts/configure-openclaw-docker.js
docker compose up -d --force-recreate openclaw backend
```

## Recent API surfaces (no extra nginx config)

All proxied under `/api` (rebuild backend + frontend images after upgrade):

| Feature | Path / notes |
|---------|----------------|
| Master data | `/api/master-data` + OpenSearch indices; UI `/master-data`; Admin Documents RAG `/admin/documents-rag`; agents `master_data_*` |
| OpenSearch Dashboards | `/opensearch/` admin BFF (cookie); never publish `:9200`/`:5601` |
| Notification dismiss | Shared bell feed (`NotificationProvider`): Clear dismisses platform + agent responses; composite standup+agent keys in `user_feed_dismissals` |
| Chat feedback | `/api/feedback` |
| OpenConnector | `/api/openconnector`, MCP via `OPENCONNECTOR_MCP_URL` |
| Email inbound | `POST /api/integrations/email-inbound/:definitionId` |
| BYOK LLM / vault | Profile provider + Settings → API Keys (`Platform_BYOK` etc.). Non-platform Profiles auto-seed unset slots. Ollama needs `optional-ollama` |
| DeepSeek | Platform/OpenClaw: set `OPENAI_*` + `OPENCLAW_MODEL_PRIMARY` to DeepSeek V4 cloud. Brain `deepseek`: cloud V4 + thinking mode UI; or Ollama endpoint without key. Profile BYOK `deepseek` → local Ollama |
| Brain thinking | DeepSeek / OpenRouter only: `thinkingMode` + `thinkingEffort` on Brain node; outputs `reasoning_content`, `thinking_mode` |
| `email_send` tool | `POST /api/tools/email-send` (SMTP + optional calendar ICS); granted to agents at boot |
| `notify_ceo` tool | `POST /api/tools/notify-ceo` (in-app push to entitled CEO user); granted to agents at boot |
| Broadcast | `POST /api/broadcast` (CEO/Admin); UI `/broadcast` — tenant OpenClaw sessions; LLM intent for status+notify; paced fan-out (avoids TPM 429) |
| Org doc sync | `POST /api/agents/org/sync` — rebuilds `ORG.md` + COO `AGENTS.md` (tenant session keys); Dashboard **Resync ORG.md & AGENTS.md**; Workspace UI reads per-CEO tenant path |
| COO specialty delegate | COO chat hard-path: AGENTS.md purpose intent classify → Kanban + delegation (max 1 specialist) |
| Kanban multi-tenant | `kanban_tasks.owner_user_id` — list/get/SQL-scoped; standup/COO/tools/job/workflow creates stamp owner; shared agent grants never imply ownership; orphans without owner stay hidden |
| Lean Kanban board | Generic task board for agent / workflow / pipeline cards — no Job applications filter button or job-pipeline status banner (job setup stays under Job profiles / Job workflows) |
| Lean CEO onboard | Default grants: COO (`balserve`) + Workflow Builder + Platform Help; `pruneSharedStandardAgentGrants` at boot; Dashboard **OrgDesigner** for departments / agents |
| Master Data + RAG | Tables in SQLite; documents in OpenSearch (`master_data_*` tools). Per-user meta+search indices; admin **Documents RAG** for platform index |
| Platform Help | Agent `platformhelp` + `knowledgebase/platform-help/` → **platform** OpenSearch indices (not per-CEO copies) |
| Agent chat tools UI | Assistant bubbles show gear pills for Agent OS tool calls (`content_tool_logs`) |
| Notification tooltips | Bell panel snippet hover shows full title/body / agent response |
| AgentExchange | `GET /api/agent-exchange` (CEO/Admin), UI `/agent-exchange` — Public vs Secured badges; **Test agent** panel; IP policy default **deny_all** (allow_all / whitelist); owner unpublish; Admin **A2A logs** `/admin/a2a-invocations` |
| Admin A2A logs | `GET /api/admin/a2a-invocations` — card/token/invoke audit including IP/OAuth denials |
| AgentExchange test | `GET /api/agent-exchange/:publishId/test-sample`, `POST /api/agent-exchange/:publishId/test` — authenticated owner test invoke (sync or async + callback; owner bypasses IP/OAuth for testing) |
| Workflow A2A | `POST /api/a2a/:publishId` (sync/async; public or Bearer); card at `/.well-known/agent-card.json`; secured: `POST /api/a2a/:publishId/oauth/token`. Default **deny_all** until policy changed. Async callbacks: `a2a.workflow.completed|failed|cancelled` webhook JSON; mock inbox `POST/GET /api/a2a-callback-inbox`. Env: `A2A_*` + `*_FULL_REBUILD_DAYS` in `.env.example`. VPS real client IP: `docker-compose.vps-client-ip.yml`. |
| hPanel shell + themes | Collapsible left nav, topbar profile menu + **ThemeToggle** (light/dark via `data-theme` / `agent-os-theme`); CSS tokens `#f7f8f9` / `#0f1115` |
| Agent Workspaces Add agent | Primary create path: `/workspace` → **Add agent** (`AddAgentForm`); Dashboard org chart **Design** still has an add modal |
| Tools nav | CEO nav label **Tools** → `/content-tools` (content-tools plugin/API name unchanged); **Tools → Model** maps per-tool LLM models (BYOK-aware; owner-scoped `tool_model_overrides`) |
| Workflow fullscreen editor | `/workflows/:id/edit` hides platform nav/topbar (`shell-focus-mode`); compact nodes/panes; **Exit to workflows** |
| Register MCP / Agents CTAs | Primary accent buttons + shared `page-hero` alignment on MCP registry and External Agents |
| COO status checker | `POST /api/tools/status-checker` (COO grant only) + `POST /api/cron/run-status-checker` (returns `html` for Dashboard popup); daily `COO_STATUS_CHECKER_CRON` (default `0 9 * * *`) → standup post + HTML email per CEO |
| Scheduled goals | `GET/POST/PATCH /api/scheduled-goals` (+ pause/resume/run-now); cadence **hourly**\|daily\|weekdays\|weekly; COO tools `scheduled_goal_*`; master tick `SCHEDULED_GOALS_CRON`. UI: **/scheduled-goals** create/**edit**. Platform Help **28**. Verify: `bash deploy/scripts/vps-verify-scheduled-goals.sh` |
| Company setup | `GET/POST/PUT /api/company-setup/*` (gate, funnel, design, apply, **`GET /blueprints?industry=`**, **`GET/PUT /company-memory`** for Update Company Details). Industry packs + admin publish as before. UI: **/company-setup** + avatar **Update Company Details** `/update-company-details` → Knowledge `company_memory`. Help **29** + **35**. Distinct from Onboarding Helper **27**. |
| IBKR Monthly + Summary | Local bridge package + W1–W5 workflows (seeds). **IBKR Summary** UI `/ibkr-summary` + APIs `GET /api/ibkr-trading/summary`, `…/day`, `…/clear-transactional` (owner-scoped; keeps workflow Variables). Laptop book: `POST …/account-snapshot/ingest`, `GET …/account-snapshot/latest`. Service `ibkr-transactional-clear.js`. CEO help **20**; ops `knowledgebase/IBKR-MONTHLY-WORKFLOWS.md`. Rebuild backend **and** frontend after bridge/Summary changes. |
| Data retention | `platform_users.data_retention_days` (30/60/90/120/365) + `GET/PUT /api/efficiency/retention`, `POST /api/efficiency/retention/purge`, `POST /api/cron/run-data-retention`; daily `DATA_RETENTION_CRON` (default `15 3 * * *`) purges aged chats / standup messages / workflow runs **and** aged Content Explorer inbound + `media/generated/<ceo>/` files (hard delete by mtime) |
| Org Storage (MB) | `GET /api/efficiency/storage` (+ `storage_mb` / `storage_breakdown` on summary) → Efficiency View **Org** tile. Counts chats, runs, Master Data files, **owner OpenSearch RAG indices**, generated media, OpenClaw tenant. Click **i** for breakdown. |
| Cron env reference | `deploy/scripts/ensure-cron-env.sh` appends the commented cron block (all 7 schedules, defaults) to `deploy/.env` on every deploy; docs: `knowledgebase/platform-help/19-scheduled-jobs-and-crons.md` |
| Free STT/TTS (optional-voice) | `ensure-voice-env.sh` writes `SPEECH_STT_URL` / `SPEECH_TTS_URL` and starts `whisper` + `piper`; Agent Chat mic + `speech_stt`/`speech_tts` nodes. Skip: `SKIP_VOICE=1`. Docs: platform-help **25** |
| Published Scenes / public VR | Guest `/p/vr/:slug` + `/api/public/vr/*` (no auth); publish from Avatars / Published Scenes nav. Guest artifact tokens ≠ `MEDIA_PUBLIC_SIGNED` |
| Agent channels | Slack/WhatsApp BYOK wizard → vault + OpenClaw bindings; outbound **`MEDIA:`** attach; inbound → `inbound/attachments/` (OpenClaw `media/inbound` staging deleted after mirror). WhatsApp **`groupPolicy` defaults to `disabled`** so `@g.us` group traffic is rejected before media download (DM `allowFrom` alone does not cover groups; set allowlist/open in Channels wizard if intentional). `/api/agent-channels`; platform-help **24**; `OPENCLAW_MEDIA_MAX_MB` (default 128) applied by `configure-openclaw-docker.js` |
| Content Explorer | CEO file browser `/content-explorer` → list/download + `POST /api/workspace/content-explorer/delete` (hard delete selected/all); `wa-*` channel media labeled WhatsApp/Telegram; platform-help **26** |
| CEO home chat + My Org | Post-login home `/` is agent chat (default COO + agent picker); former dashboard org chart/standups at `/org` nav **My Org** |
| Chat side panes | History + Browser session collapsible; **hidden by default**; clock / window icons next to New chat |
| COO channel inbound SOUL | BalServe `SOUL.md` hard rule: list_inbound → index RAG-able docs → master_data_rag; media via analyze/STT. Org resync injects same tools line into COO AGENTS |
| COO ad-hoc file work | Hard-path skips **"don't delegate"** and find/download/attach of existing files (`isRefuseDelegationRequest` / `isCooNativeWork`); `list_inbound_attachments` returns `paste_in_chat` download links |
| Profile role title | Display-only `platform_users.role_title` via `PATCH /auth/me` (presets/custom); org chart root + profile menu; auth role stays `ceo` |
| Onboarding Helper | OpenClaw `onboardinghelper` + `/onboarding` Review checkboxes; tools `onboarding_save_proposal` / `onboarding_apply_proposal` (seeded at startup); templates `openclaw-workspace-templates/onboardinghelper/`; E2E prompts + `backend/scripts/e2e-onboarding-wf-prompts.mjs` → platform-help **27** |
| Profile LLM catalog | Provider + model on **Register** and **Profile** (`llm_model`); `GET /api/auth/llm-catalog`; registry `backend/src/config/llm-provider-registry.js`; BYOK vault after login; soft fallbacks `OPENAI_BYOK_MODEL` / `OPENROUTER_MODEL` |
| Generated media lockdown | `/api/media/openclaw/*` auth-only by default; WhatsApp uses disk `MEDIA:`; Dashboard inline players (Bearer→blob). Opt-in signed public: `MEDIA_PUBLIC_SIGNED=1` in `deploy/.env`. Docs: platform-help **11** |
| Platform feedback (Admin) | `/admin/platform-feedback` + COO tools `platform_feedback_*`; statuses open / implemented / rejected |

**Repeatable deploy (laptop → VPS):**

```powershell
# From repo root (default HostIp 76.13.209.30):
.\deploy\scripts\sync-to-vps.ps1
# frontend UI changes (Scheduled goals Edit, nav, etc.) — always include frontend:
.\deploy\scripts\sync-to-vps.ps1 -Services frontend
# backend + OpenClaw (API / tools / templates / scheduled goals service):
.\deploy\scripts\sync-to-vps.ps1 -Services "backend openclaw"
# typical full product ship (UI + API + gateway):
.\deploy\scripts\sync-to-vps.ps1 -Services "frontend backend openclaw"
# skip post-deploy smoke + platform verify:
.\deploy\scripts\sync-to-vps.ps1 -SkipSmoke
# force rebuild without Docker layer cache (stale SPA/API images):
.\deploy\scripts\sync-to-vps.ps1 -NoCache
```

`sync-to-vps.ps1` syncs **full build contexts**: `frontend/src` + package files, `backend/src` + key scripts (incl. `seed-platform-help-agent.js`, `_smoke-scheduled-goals.mjs`, `reupload-platform-help-docs.js`), `deploy/*` (**including `vps-verify-scheduled-goals.sh`**, `ensure-cron-env.sh`, `deploy/static/flolah-home`) + compose (`SCHEDULED_GOALS_CRON`), OpenClaw templates (COO scheduled-goal tools), and `knowledgebase/platform-help/` (**28** scheduled goals, **29** company setup) — then `vps-deploy-latest.sh` rebuilds selected images, runs `ensure-cron-env.sh`, reindexes Platform Help, and verifies scheduled goals when backend is in the service set.

**After UI-only changes:** always rebuild **frontend** (backend-only leaves a stale SPA without Edit / Hourly).  
**After help-doc changes:** rebuild **backend** (corpus is COPY'd into the backend image) so RAG reupload picks up **28** / **29**.

**Public URL:** set `AGENT_OS_PUBLIC_URL` in `deploy/.env` (production app: `https://login.flolah.cloud`). Marketing homepage is the apex `https://flolah.cloud` (`deploy/static/flolah-home`). Use the login host for API smoke and prompt E2E.

**Marketing vs app hosts (end-to-end)**

| Host | Serves |
|------|--------|
| `https://flolah.cloud` | Marketing homepage (`deploy/static/flolah-home`) |
| `https://login.flolah.cloud` | Login + React SPA + `/api` (set `AGENT_OS_PUBLIC_URL` here) |

Everything is in repo — repeat a greenfield production host as:

1. DNS: **A** records `@` / `www` / `login` → VPS IPv4 (`76.13.209.30`). Optional **AAAA** to VPS IPv6 only if nginx listens on `[::]` (prod conf does).  
2. Clone/sync code to `/opt/agent-os`  
3. `deploy/.env` with secrets; set `AGENT_OS_PUBLIC_URL=https://login.flolah.cloud` after cert step  
4. `bash deploy/scripts/vps-bootstrap.sh` **or** laptop `.\deploy\scripts\sync-to-vps.ps1`  
5. First multi-SAN Let’s Encrypt cert (stops nginx briefly, **TLS-ALPN on :443** via acme.sh — needed because inbound **:80 is often blocked**):  
   `bash deploy/scripts/vps-expand-login-cert.sh`  
   Cert SANs: `flolah.cloud`, `www.flolah.cloud`, `login.flolah.cloud`. Auto-renew + nginx reload hooks under `/root/.acme.sh/`.  
6. Routine upgrades: `sync-to-vps.ps1` → `vps-deploy-latest.sh` (static perms, marketing smokes, dual-vhost nginx)

Until login DNS + cert complete, SPA remains reachable on apex paths other than `/` (e.g. `https://flolah.cloud/login`).

**TLS notes**

| Challenge | Port | Status on this VPS |
|-----------|------|--------------------|
| certbot HTTP-01 | 80 | Often **fails** (connect timeout from internet) |
| acme.sh `--alpn` | 443 | **Preferred** (`vps-expand-login-cert.sh`) |

Nginx production confs listen on both `0.0.0.0` and `[::]` for 80/443 so IPv4 + IPv6 DNS work.
The backend image (`deploy/docker/backend.Dockerfile`) **COPY**s `knowledgebase/platform-help` so Master Data RAG seeding works inside the container.

On VPS after sync (or after `git pull` on the box), `vps-deploy-latest.sh` rebuilds images and runs:

1. `ensure-*-env.sh` helpers (cron, OpenSearch, docker-tools, **voice**/SPEECH_*) then compose build/up
2. **`docker-disk-hygiene.sh`** — prune BuildKit cache older than `DOCKER_BUILDER_PRUNE_UNTIL` (default **72h**), remove dangling `<none>` images, drop leftover test containers (`oc-fix-ep`). Does **not** remove Admin-onboarded tool containers or app volumes. Skip with `SKIP_DOCKER_PRUNE=1`; full wipe with `DOCKER_BUILDER_PRUNE_ALL=1`.
3. `optional-voice` whisper + piper (unless `SKIP_VOICE=1`)
4. **`vps-verify-agent-channels.sh`** — WhatsApp/Slack drift gate (fatal; runs even with `SKIP_SMOKE=1`)
5. **`vps-verify-openclaw-chat.sh`** — repairs `openclaw.json` via `ensure-openclaw-gateway-config.js` + probes `POST /v1/chat/completions` (fatal on **404**; runs even with `SKIP_SMOKE=1`). Catches wiped `gateway.http.endpoints.chatCompletions` (container stays “healthy”, Agent Chat returns 502/404).
6. **`vps-verify-media-delivery.sh`** — MEDIA dual-write / audio MIME (fatal)
7. `vps-smoke-new-features.sh` — email_send, notify_ceo, master_data, **platformhelp agent**, org sync, A2A public + OAuth secured, shared notification dismiss, **public VR / speech / channels route probes** (skipped when `SKIP_SMOKE=1`)
8. `vps-smoke-broadcast-notify.sh` — Broadcast → TechResearcher → notify_ceo (needs OpenClaw + LLM; non-fatal)
9. `vps-smoke-deepseek-brain.sh` — DeepSeek@Ollama (non-fatal if model not pulled)
10. `vps-verify-platform.sh` — Master Data, Platform Help docs/agent/RAG, per-CEO delegation, allowlists, openclaw chat ensure scripts present

### OpenClaw chat 404 (gateway “healthy” but UI chat fails)

| Symptom | Cause |
|---------|--------|
| `POST /api/agents/*/chat` → **502**, gateway body **404 Not Found** | `openclaw.json` lost `gateway` (or `gateway.http.endpoints.chatCompletions.enabled`) |
| OpenClaw container still healthy | Healthcheck only curls `/` (Control UI), not chat API |

**Prevention (shipped):**
- Backend writes use `backend/src/services/openclaw-config-safe.js` (never drop `gateway` / `tools` / `plugins` / `browser`)
- OpenClaw entrypoint: `ensure-openclaw-gateway-config.js` → `configure-openclaw-docker.js` → channel restore
- Every deploy: `vps-verify-openclaw-chat.sh` (auto-repair + live probe)

**Manual repair:**
```bash
cd /opt/agent-os/deploy
bash scripts/vps-verify-openclaw-chat.sh
# or:
docker compose exec -T -w /opt/agent-os backend node deploy/scripts/ensure-openclaw-gateway-config.js
docker compose restart openclaw
```

Skip all smoke: `SKIP_SMOKE=1` or `sync-to-vps.ps1 -SkipSmoke` (channels + chat + media gates still run). Force clean image build: `NO_CACHE=1` or `sync-to-vps.ps1 -NoCache`. Skip voice containers: `SKIP_VOICE=1`.

### Windows UTF-8 pitfall (PowerShell / agents)

Save new backend/frontend source and deploy scripts as **UTF-8 without BOM**. UTF-16LE (common when tools write with BOM/wide chars) breaks Node (`Invalid regular expression: missing /` at line 1) and frontend `check-utf8.mjs`. After editing from Windows, confirm: first bytes of a `.js` file should be ASCII (`47 42` for `/*`, not `47 0 42 0`).

Manual disk reclaim (same script deploy uses):

```bash
# Keep last 72h of build cache (default ongoing behaviour)
bash /opt/agent-os/deploy/scripts/docker-disk-hygiene.sh
# One-shot full unused build-cache wipe (next compose build is colder)
DOCKER_BUILDER_PRUNE_ALL=1 bash /opt/agent-os/deploy/scripts/docker-disk-hygiene.sh
```

Optional targeted smokes (after deploy):

```bash
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-broadcast-routing.js
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-platform-help-seed.js
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-platform-help-rag.js
docker compose exec -T -w /opt/agent-os/backend -e TOOLS_BASE_URL=http://127.0.0.1:3001 \
  backend node scripts/vps-test-platform-help.js
docker compose exec -T -w /opt/agent-os/backend backend node scripts/vps-test-application-masterdata-notify.js
docker compose exec -T -w /opt/agent-os/backend backend node scripts/vps-test-coo-biryani-delegate.js
```

Manual Broadcast→notify check:

```bash
bash scripts/vps-smoke-broadcast-notify.sh
# or:
docker compose exec -T -w /opt/agent-os/backend -e TOOLS_BASE_URL=http://127.0.0.1:3001 \
  backend node scripts/test-broadcast-notify-ceo.js
```

Manual org resync (CEO session) after delete/rename/grant changes:

```bash
# Dashboard → Org chart → Resync ORG.md & AGENTS.md
# or:
curl -k -X POST -H "Authorization: Bearer $TOKEN" https://your-domain/api/agents/org/sync
# or inside backend container:
node scripts/sync-org-context-ceo.js ceo-bala
```

Email inbound provider URL example:

```text
https://your-domain/api/integrations/email-inbound/<workflowDefinitionId>
```


## Admin Tools Onboarding (Docker content tools)

Pull/deploy HTTP tool images on the **same Docker host as the backend**, register them as content tools, and invoke only via `/api/tools/invoke` (no host ports, not in nginx).

| Piece | Path / setting |
|-------|----------------|
| Compose overlay (mounts `docker.sock`) | `docker-compose.docker-tools.yml` |
| Env keys | `DOCKER_TOOLS_*`, `DOCKER_GID` in `.env.example` |
| Ensure keys exist | `scripts/ensure-docker-tools-env.sh` (runs from `vps-deploy-latest.sh`) |
| Enable on VPS | `scripts/enable-docker-tools-on-vps.sh` |
| Admin UI | `/admin/tool-onboarding` (TOTP step-up for pull/deploy/stop/delete) |
| Smoke (backend container) | `node scripts/test-docker-tool-onboarding-vps.js` |

Repeatable VPS enable:

```bash
cd /opt/agent-os/deploy
bash scripts/enable-docker-tools-on-vps.sh .env
# Edit DOCKER_TOOLS_REGISTRY_ALLOW (fail-closed if empty), then:
docker compose up -d --force-recreate backend
```

`vps-deploy-latest.sh` defaults `COMPOSE_FILE` to include the docker-tools overlay. Keep `DOCKER_TOOLS_ENABLED=0` until registry allow-list + sock are ready. Tool containers are **not** Compose services (Hostinger hPanel may omit them); manage via Admin UI or `docker ps --filter label=agent-os.managed=1`.
## Optional Compose profiles

```bash
# Local MCP SSE test server (port 3099 internal) — used for Brain+MCP smoke test
docker compose --profile optional-mcp up -d
# Seed into registry: docker compose exec backend node scripts/seed-local-mcp-random-sse.js

# Real OpenConnector runtime (port 3000 internal)
# Set OPENCONNECTOR_URL=http://openconnector:3000 and OPENCONNECTOR_ADMIN_TOKEN in .env
docker compose --profile optional-openconnector up -d

# OpenConnector MCP mock (port 3105 internal) — staging/e2e only
# Set OPENCONNECTOR_MCP_URL=http://openconnector-mcp-mock:3105/mcp in .env
docker compose --profile optional-openconnector-mock up -d
docker compose exec backend node scripts/seed-openconnector-mcp.js

# Ollama fallback / BYOK local models
docker compose --profile optional-ollama up -d
# pull a model after start: docker compose exec ollama ollama pull llama3.2

# DeepSeek on Brain: prefer cloud V4 (API key on the Brain node in the editor).
# Optional local Ollama DeepSeek (Profile BYOK "deepseek" / legacy Brain Ollama endpoint):
docker compose --profile optional-ollama up -d ollama
docker compose exec ollama ollama pull deepseek-v3
# docker compose exec backend node scripts/test-deepseek-brain-workflow.js

# Optional Hunyuan3D GPU (Avatars text/image → GLB). Requires NVIDIA Container Toolkit.
# Set HUNYUAN3D_URL=http://hunyuan3d:7860 on the backend service.
# docker compose --profile optional-hunyuan3d up -d

# Free STT/TTS (faster-whisper + Piper) — Agent Chat mic, speech_stt / speech_tts nodes.
# ensure-voice-env.sh (from up.sh / vps-deploy-latest.sh) writes SPEECH_* and starts these.
# Manual: docker compose --profile optional-voice up -d --build whisper piper
# Skip on tiny hosts: SKIP_VOICE=1 bash scripts/vps-deploy-latest.sh
# Docs: knowledgebase/platform-help/25-speech-and-published-scenes.md

# Brave Search:
#   - Agent tool brave_web_search: set BRAVE_API_KEY in deploy/.env (passed to backend).
#     Non-platform Profiles use vault BRAVE_SEARCH_BYOK instead.
#   - Optional MCP (BYOK HTTP wrapper — no BRAVE_API_KEY in that container):
docker compose --profile optional-brave-mcp up -d --build brave-search-mcp
# docker compose exec backend node scripts/seed-brave-search-mcp.js

# Browser login helpers (two different things — do not conflate):
#   A) ENABLE_VNC=1 → Xvfb+x11vnc inside the openclaw container (Playwright display).
#      Compose does not publish :5900 by default; use docker compose exec / add ports if needed.
#   B) --profile optional-browser-login → linuxserver webtop on NOVNC_PORT (default 6080)
#      for manual cookie/profile work — shares openclaw_home, not OpenClaw's DISPLAY.
docker compose --profile optional-browser-login up -d
# noVNC UI: http://host:6080 — see knowledgebase/DEPLOY-CENTOS-PODMAN.md
```

Pass profiles to `up.sh`:

```bash
./scripts/up.sh --profile optional-openconnector
```

## Deploy latest changes (VPS)

After pushing to GitHub, rebuild and recreate on the server so images pick up source changes (OpenClaw entrypoint also re-runs `configure-openclaw-docker.js` on start).

**On the VPS** (when `/opt/agent-os` can `git pull`):

```bash
cd /opt/agent-os/deploy
bash scripts/vps-deploy-latest.sh
# frontend only:
SERVICES=frontend bash scripts/vps-deploy-latest.sh
```

**From a Windows laptop** (when the VPS cannot authenticate to GitHub):

```powershell
# from agent-os repo root
.\deploy\scripts\sync-to-vps.ps1
.\deploy\scripts\sync-to-vps.ps1 -Services frontend
```

Verify chat media + responsive CSS markers:

```bash
bash /opt/agent-os/deploy/scripts/vps-verify-frontend-media.sh
```

Full platform verify (Master Data, delegation, notifications, allowlists):

```bash
bash /opt/agent-os/deploy/scripts/vps-verify-platform.sh
```

Frontend-only rebuild + bundle markers:

```bash
bash /opt/agent-os/deploy/scripts/vps-rebuild-frontend.sh
```

Quick UI + media verify (hPanel + themes, fullscreen editor, Register CTAs, media auth):

```bash
bash /opt/agent-os/deploy/scripts/vps-verify-frontend-media.sh
```

**Frontend encoding:** sources under `frontend/src` must be **UTF-8** (not UTF-16). On Windows, UTF-16 LE breaks `vite build` (`Expected ";" but found "\x00"`). Check with `node scripts/check-frontend-utf8.mjs` or `cd frontend && npm run check:utf8` (also runs as part of `frontend` `npm run build` / Docker image build).

**Post-deploy frontend markers** (fail = rebuild with `NO_CACHE=1` / `-NoCache`):

| Marker | Meaning |
|--------|---------|
| `app-topbar` / `profile-menu` / `theme-toggle-btn` | hPanel shell + theme toggle |
| `#f7f8f9` / `#0f1115` | Light and dark `--bg` tokens |
| `agent-os-theme` / `Switch to dark` | Theme persistence + toggle copy in JS bundle |
| `Reports to (COO default)` / `agent-workspace-card` | Agent Workspaces Add agent UI |
| `nav-section-chevron` | Collapsible left nav sections |
| `shell-focus-mode` / `Exit to workflows` / `wf-editor-exit` | Fullscreen workflow editor |
| `Register MCP` / `Register Agents` / `page-hero` | Aligned primary CTAs |
| `NotificationProvider` / Broadcast / Resync ORG | Existing product UI |
| `Test agent` / `agentExchangeTest` / `Deny all` | AgentExchange test panel + deny_all IP badge |
| `A2A logs` / `adminA2AInvocations` / `a2a-invocations` | Admin A2A invocation report page |

Always recreate **nginx** after recreating **frontend** so the reverse proxy picks up the new container IP (otherwise you may see HTTP 502).

## VPS client IP overlay (A2A IP policy)

On production VPS hosts, `vps-deploy-latest.sh` and `sync-to-vps.ps1` include **`docker-compose.vps-client-ip.yml`** in `COMPOSE_FILE` by default:

```bash
export COMPOSE_FILE="docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml"
```

Docker’s bridge port proxy makes nginx see the gateway IP instead of the real remote address. The overlay:

- Runs **nginx** in `network_mode: host` with `nginx.host-network.conf`
- Publishes **backend** and **frontend** on loopback only (`127.0.0.1:3001`, `127.0.0.1:8080`)

That lets AgentExchange **deny_all / whitelist** IP checks use the actual client IP. Without it, every external caller can look like the same bridge address and whitelist rules will not work as intended.

Local dev (non-VPS) usually omits this file — use the base `docker-compose.yml` only.

**API list pagination:** CEO SPA list endpoints return `{ domainKey, total, limit, offset, has_more }` (shared helpers in `backend/src/lib/pagination.js`). Rebuild **backend** + **frontend** after changes. Details: root `README.md` → API (backend).

## A2A / AgentExchange testing

After deploy, verify UI markers in `vps-deploy-latest.sh` smoke output: `Test agent`, `agentExchangeTest`, `Deny all`, Admin `A2A logs` / `adminA2AInvocations`, and backend `/:publishId/test` route.

**In the UI (CEO/Admin):** open **AgentExchange** → expand an agent → **Test agent**. Owners can invoke even when public A2A is **Deny all** (test path bypasses IP/OAuth). Use callback URL for async workflows.

**Admin denial / success report:** open **A2A logs** (`/admin/a2a-invocations`) for platform-wide card, OAuth, and invoke history (including blocks that never start a workflow).

**API (authenticated):**

```bash
# Sample input for Test panel autofill
curl -k -H "Authorization: Bearer $TOKEN" \
  "https://your-domain/api/agent-exchange/$PUBLISH_ID/test-sample"

# Owner test invoke (sync or async + optional callbackUrl)
curl -k -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"hello"}' \
  "https://your-domain/api/agent-exchange/$PUBLISH_ID/test"
```

**Backend scripts (inside container):**

```bash
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-a2a-agent-exchange-security.js
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-workflow-a2a-async-publish.js
docker compose exec -T -w /opt/agent-os/backend backend node scripts/vps-publish-async-a2a-callback-test.js
```

Public A2A (`POST /api/a2a/:publishId`) stays blocked until access policy is **allow_all** or **whitelist** (and IP passes whitelist when set).

## Build images only

```bash
docker compose build backend frontend openclaw
# include mock when using the profile:
docker compose --profile optional-openconnector build openconnector-mcp-mock
```

## CentOS / Podman / Hostinger

See **knowledgebase/DEPLOY-CENTOS-PODMAN.md** for SELinux (`:Z` volumes), rootless Podman, firewall, and browser-on-headless-server notes. Same Compose stack works on Hostinger Ubuntu/Debian with Docker Engine.

```bash
USE_PODMAN=1 ./scripts/up.sh
# or: podman-compose -f docker-compose.yml up -d
```

## Smoke test

```bash
curl -k https://localhost/health
curl -k https://localhost/api/health
```

From repo (against deployed URL):

```bash
AGENT_OS_BASE_URL=https://your-domain cd ../backend && npm run test:smoke
```

### This Week Digest

Top-nav **Digest** (/this-week) loads owner-scoped GET /api/this-week-digest (KPIs, workflows, activity). Time Saved uses THIS_WEEK_MINUTES_PER_TASK (default 45). Est. Value = sum((minutes/60) * agent.hourly_rate_usd) for completed Kanban; workflows/unassigned use THIS_WEEK_VALUE_USD_PER_HOUR (default 10). Hire form sets hourly_rate_usd (default 10). Insights assessor is separate. COO tool this_week_digest for chat explainability. Home **OEI** via owner-scoped GET /api/operational-effectiveness + COO tool operational_effectiveness (rules-only; not Digest value).

### Workspace Builder

Visual designer at `/workspace-designer` stores pages in `company_workspace_boards` (JSON components + data bindings). **Set as Default** targets menu Workspace (`/work`). Seed **operating-workspace** to recreate the hard-built layout via JSON. Backend: `/api/workspace-boards/*` (CEO/owner-scoped). Differentiator: AI workers / Workflow Builder can later generate the same JSON document.
