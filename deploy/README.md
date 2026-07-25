# Agent OS — Container deployment

Production stack for Agent OS: **nginx**, **frontend**, **backend**, **OpenClaw gateway**, plus optional **init**, **MCP**, **OpenConnector mock**, **Ollama**, and **browser-login** services.

Works with **Docker Compose** and **Podman Compose** on CentOS/RHEL, Ubuntu (Hostinger VPS), and other Linux hosts.

## Containers

| Service | Required | Port (host) | Purpose |
|---------|----------|-------------|---------|
| `nginx` | Yes | 80, 443 | TLS, `/` → frontend, `/api` → backend |
| `frontend` | Yes | internal | React SPA (Vite build) |
| `backend` | Yes | internal | API, cron, workflows, SQLite, master-data, feedback, BYOK |
| `openclaw` | Yes | internal | Gateway :18789, browser tool, skills/plugins |
| `init` | First run | — | One-shot bootstrap (`--profile init`) |
| `mcp-random-sse` | Optional | internal | Dev MCP + SSE test server (`optional-mcp`) |
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
| Browser TOOLS.md sections | manual sync script | ✓ |
| Session visibility (`tools.sessions.visibility`) | manual one-off | ✓ `agent` |
| Ollama fallback provider | ✓ | ✓ (use `optional-ollama` profile) |
| Hot-reload workspace MD (bootstrap watcher) | ✓ | ✓ (includes `AGENT-OS-OPS.md`) |
| Platform agent workspace templates (Admin + CEO apply/publish) | ✓ | ✓ (DB table `platform_agent_workspace_templates`) |
| Custom workflow scripts (Python/JS sandbox) | ✓ | ✓ (`python3` in backend image) |
| Per-agent tool grants / allowlists | backend startup sync | ✓ backend startup |
| Master-data / feedback / BYOK LLM | ✓ (schema on startup) | ✓ rebuild backend image |
| OpenConnector MCP registration | `seed-openconnector-mcp.js` | ✓ post-up when `OPENCONNECTOR_MCP_URL` set |

Verify after init:

```bash
docker compose --profile init run --rm init
# or against running volume:
docker compose run --rm openclaw node deploy/scripts/verify-openclaw-parity.js
```

Skip Job Applicant in init: add `--no-job-applicant` to the bootstrap command in `openclaw-entrypoint.sh` or run init with a custom command.

## Quick start

```bash
cd agent-os/deploy
cp .env.example .env
# Edit: AGENT_OS_PUBLIC_URL, OPENCLAW_GATEWAY_TOKEN, OPENAI_API_KEY, admin password
# up.sh auto-fills TOOLS_API_KEY + AGENT_OS_INTERNAL_TOKEN if empty/placeholder

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

Ensure `TOOLS_BASE_URL=http://127.0.0.1:3001` in `.env` (see `.env.example`) so backend tool self-invoke does not use public HTTPS. For VPS A2A IP whitelist, see **[VPS client IP overlay](#vps-client-ip-overlay-a2a-ip-policy)** (`COMPOSE_FILE` includes `docker-compose.vps-client-ip.yml`).

## Environment & LLM secrets

All secrets live in **`deploy/.env`** (gitignored). Compose injects them as **runtime environment variables** — they are **not** baked into images. At init, **`OPENCLAW_GATEWAY_TOKEN`** and **`TOOLS_API_KEY`** are also written into `openclaw.json` (gateway auth + content-tools plugin).

### Shared keys: backend ↔ OpenClaw

| Key | Backend | OpenClaw |
|-----|---------|----------|
| `OPENCLAW_GATEWAY_TOKEN` | `OPENCLAW_GATEWAY_TOKEN` env | `gateway.auth.token` in openclaw.json |
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
| `TOOLS_API_KEY` | OpenClaw content-tools ↔ backend (required in production; must match plugin `apiKey`) |
| `OPENAI_COO_MODEL`, `OPENAI_INTENT_MODEL` | COO / intent classifier |
| `REPLICATE_API_TOKEN` | Video generation content tool |
| `OPENROUTER_*` | Dev/test scripts; Brain nodes still use per-node keys |
| `CUSTOM_SCRIPT_*` | Python/JS workflow script sandbox (`python3` in image); includes LLM security review at registration |
| `WORKFLOW_SMTP_*` | Send Email workflow task, `email_send` content tool (incl. ICS invites), MFA email OTP. Use a verified sender domain with your SMTP provider. |
| `WORKFLOW_TEST_EMAIL_TO` | Optional recipient for SMTP smoke scripts (`test-email-send-tool.js`) |
| `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` | Optional DeepSeek override. Brain `deepseek` defaults to cloud V4 (`https://api.deepseek.com/v1`, `deepseek-v4-flash`) with per-node API key; set these to Ollama for local. Profile BYOK `deepseek` still uses local Ollama when pointed here. |
| `BRAVE_API_KEY` | Used by **test scripts / workflow run input only**. Brave MCP container is BYOK (workflow headers). Profile `optional-brave-mcp`. Seed: `seed-brave-search-mcp.js`. Demo: `seed-balaji-brave-byok-workflow.js`. |
| `MFA_MODE`, `AGENT_OS_REQUIRE_MFA`, `AGENT_OS_DISABLE_MFA` | Platform MFA defaults (production: `MFA_MODE=TOTP`, `AGENT_OS_REQUIRE_MFA=1`) |
| `EMAIL_INBOUND_WEBHOOK_SECRET` | Optional platform secret for email inbound webhooks |
| `OPENCONNECTOR_URL` | Base URL of the OpenConnector runtime (e.g. `http://openconnector:3000`). Enables Connector workflow nodes + User Profile auto-provision. |
| `OPENCONNECTOR_ADMIN_TOKEN` | Admin token for the OpenConnector runtime (bootstraps user runtime tokens) |
| `OPENCONNECTOR_ENCRYPTION_KEY` | Encryption key for OpenConnector token store |
| `OPENCONNECTOR_MCP_*` | OpenConnector MCP URL / bearer / transport (Brain+MCP tool-calling) |
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
- `VITE_API_URL=/api` — frontend calls nginx-relative API path
- Do **not** publish OpenClaw port 18789 to the host

After changing keys in `.env`:

```bash
docker compose run --rm openclaw node deploy/scripts/configure-openclaw-docker.js
docker compose up -d --force-recreate openclaw backend
```

## Recent API surfaces (no extra nginx config)

All proxied under `/api` (rebuild backend + frontend images after upgrade):

| Feature | Path / notes |
|---------|----------------|
| Master data | `/api/master-data`, UI `/master-data`; agents use `master_data_*` content tools (row CRUD + RAG, no schema alter) |
| Notification dismiss | Shared bell feed (`NotificationProvider`): Clear dismisses platform + agent responses; composite standup+agent keys in `user_feed_dismissals` |
| Chat feedback | `/api/feedback` |
| OpenConnector | `/api/openconnector`, MCP via `OPENCONNECTOR_MCP_URL` |
| Email inbound | `POST /api/integrations/email-inbound/:definitionId` |
| BYOK LLM | User Profile → stored in DB; Ollama needs `optional-ollama` |
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
| Master Data + RAG | `master_data_list_*` / `master_data_rag` — purpose-driven list_tables→list_rows; RAG for documents |
| Agent chat tools UI | Assistant bubbles show gear pills for Agent OS tool calls (`content_tool_logs`) |
| Notification tooltips | Bell panel snippet hover shows full title/body / agent response |
| AgentExchange | `GET /api/agent-exchange` (CEO/Admin), UI `/agent-exchange` — Public vs Secured badges; **Test agent** panel; IP policy default **deny_all** (allow_all / whitelist); owner unpublish; Admin **A2A logs** `/admin/a2a-invocations` |
| Admin A2A logs | `GET /api/admin/a2a-invocations` — card/token/invoke audit including IP/OAuth denials |
| AgentExchange test | `GET /api/agent-exchange/:publishId/test-sample`, `POST /api/agent-exchange/:publishId/test` — authenticated owner test invoke (sync or async + callback; owner bypasses IP/OAuth for testing) |
| Workflow A2A | `POST /api/a2a/:publishId` (sync/async; public or Bearer); card at `/.well-known/agent-card.json`; secured: `POST /api/a2a/:publishId/oauth/token`. Default **deny_all** until policy changed. Async callbacks: `a2a.workflow.completed|failed|cancelled` webhook JSON; mock inbox `POST/GET /api/a2a-callback-inbox`. Env: `A2A_*` + `*_FULL_REBUILD_DAYS` in `.env.example`. VPS real client IP: `docker-compose.vps-client-ip.yml`. |
| hPanel light UI | White shell: left collapsible nav sections, topbar profile avatar menu, light CSS tokens (`--bg #f7f8f9`) |
| Workflow fullscreen editor | `/workflows/:id/edit` hides platform nav/topbar (`shell-focus-mode`); compact nodes/panes; **Exit to workflows** |
| Register MCP / Agents CTAs | Primary accent buttons + shared `page-hero` alignment on MCP registry and External Agents |
| Platform Help | Agent `platformhelp` + `knowledgebase/platform-help/` corpus in backend image → Master Data RAG |

**Repeatable deploy (laptop → VPS):**

```powershell
# From repo root (default HostIp 76.13.209.30):
.\deploy\scripts\sync-to-vps.ps1
# frontend-only:
.\deploy\scripts\sync-to-vps.ps1 -Services frontend
# backend + OpenClaw (API / tools / templates):
.\deploy\scripts\sync-to-vps.ps1 -Services "backend openclaw"
# skip post-deploy smoke + platform verify:
.\deploy\scripts\sync-to-vps.ps1 -SkipSmoke
# force rebuild without Docker layer cache (stale images):
.\deploy\scripts\sync-to-vps.ps1 -NoCache
```

`sync-to-vps.ps1` syncs **full build contexts**: `frontend/src` + package files, `backend/src` + key scripts (incl. `seed-platform-help-agent.js`), `deploy/*`, `scripts/`, OpenClaw extensions/skills/templates (COO, TechResearcher, ApplicationAgent, Workflow Builder, **Platform Help**), and `knowledgebase/platform-help/` — then runs `vps-deploy-latest.sh`.

The backend image (`deploy/docker/backend.Dockerfile`) **COPY**s `knowledgebase/platform-help` so Master Data RAG seeding works inside the container.

On VPS after sync (or after `git pull` on the box), `vps-deploy-latest.sh` rebuilds images and runs:

1. `vps-smoke-new-features.sh` — email_send, notify_ceo, master_data, **platformhelp agent**, org sync, A2A public + OAuth secured, shared notification dismiss
2. `vps-smoke-broadcast-notify.sh` — Broadcast → TechResearcher → notify_ceo (needs OpenClaw + LLM; non-fatal)
3. `vps-smoke-deepseek-brain.sh` — DeepSeek@Ollama (non-fatal if model not pulled)
4. `vps-verify-platform.sh` — Master Data, Platform Help docs/agent/RAG, per-CEO delegation, NotificationProvider + dismiss APIs, allowlists

Skip all smoke: `SKIP_SMOKE=1` or `sync-to-vps.ps1 -SkipSmoke`. Force clean image build: `NO_CACHE=1` or `sync-to-vps.ps1 -NoCache`.

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

# Browser login helper — set ENABLE_VNC=1 in .env, then:
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

Quick UI + media verify (hPanel, fullscreen editor, Register CTAs, media auth):

```bash
bash /opt/agent-os/deploy/scripts/vps-verify-frontend-media.sh
```

**Post-deploy frontend markers** (fail = rebuild with `NO_CACHE=1` / `-NoCache`):

| Marker | Meaning |
|--------|---------|
| `app-topbar` / `profile-menu` / `#f7f8f9` | hPanel light shell |
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
