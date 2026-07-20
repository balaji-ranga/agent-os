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
| `mcp-random-sse` | Optional | internal | Dev MCP + SSE test server |
| `openconnector-mcp-mock` | Optional | internal | OpenConnector MCP mock (`:3105`) |
| `ollama` | Optional | internal | Local LLM fallback for OpenClaw / BYOK |
| `novnc` | Optional | 6080 | Desktop for manual job-portal login |

## Volumes (persist)

| Volume | Mount | Contents |
|--------|-------|----------|
| `agent_os_data` | backend `/data/agent-os` | SQLite (`agent-os.db`) — includes master-data, feedback, user LLM settings |
| `openclaw_home` | backend + openclaw `/root/.openclaw` | `openclaw.json`, workspaces, browser profile, media, sessions |
| `workflow_fs` | backend `/data/workflow-fs` | Filesystem workflow node roots (`WORKFLOW_FS_ROOTS`) |
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
| Hot-reload workspace MD (bootstrap watcher) | ✓ | ✓ |
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

Ensure `TOOLS_BASE_URL=http://127.0.0.1:3001` in `.env` (see `.env.example`) so backend tool self-invoke does not use public HTTPS.

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
| `OLLAMA_BASE_URL`, `OLLAMA_API_KEY` | Local Ollama fallback |
| `OPENROUTER_*` | If using OpenRouter-backed models in OpenClaw config |

### Backend (`backend` container)

Gets the same gateway LLM vars plus:

| Variable | Purpose |
|----------|---------|
| `AGENT_OS_INTERNAL_TOKEN` | Workflow runner, tools proxy, cron-callback (required in production) |
| `OPENAI_COO_MODEL`, `OPENAI_INTENT_MODEL` | COO / intent classifier |
| `REPLICATE_API_TOKEN` | Video generation content tool |
| `OPENROUTER_*` | Dev/test scripts; Brain nodes still use per-node keys |
| `CUSTOM_SCRIPT_*` | Python/JS workflow script sandbox (`python3` in image); includes LLM security review at registration |
| `WORKFLOW_SMTP_*` | Send Email workflow task + MFA email OTP |
| `MFA_MODE`, `AGENT_OS_REQUIRE_MFA`, `AGENT_OS_DISABLE_MFA` | Platform MFA defaults |
| `EMAIL_INBOUND_WEBHOOK_SECRET` | Optional platform secret for email inbound webhooks |
| `OPENCONNECTOR_MCP_*` | OpenConnector MCP URL / bearer / transport |
| `WORKFLOW_FS_ROOTS` | Allowed roots for filesystem workflow nodes (default `/data/workflow-fs`) |

**Workflow Brain nodes:** published workflows require API keys **on each Brain node** in the editor — platform `.env` keys are not used at run time (see `backend/.env.example`). User BYOK keys live in SQLite (User Profile).

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
| Master data | `/api/master-data`, UI `/master-data` |
| Chat feedback | `/api/feedback` |
| OpenConnector | `/api/openconnector`, MCP via `OPENCONNECTOR_MCP_URL` |
| Email inbound | `POST /api/integrations/email-inbound/:definitionId` |
| BYOK LLM | User Profile → stored in DB; Ollama needs `optional-ollama` |

Email inbound provider URL example:

```text
https://your-domain/api/integrations/email-inbound/<workflowDefinitionId>
```

## Optional Compose profiles

```bash
# Local MCP SSE test server (port 3099 internal)
docker compose --profile optional-mcp up -d

# OpenConnector MCP mock (port 3105 internal)
# Set in .env: OPENCONNECTOR_MCP_URL=http://openconnector-mcp-mock:3105/mcp
docker compose --profile optional-openconnector up -d
docker compose exec backend node scripts/seed-openconnector-mcp.js

# Ollama fallback / BYOK local models
docker compose --profile optional-ollama up -d
# pull a model after start: docker compose exec ollama ollama pull llama3.2

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

Always recreate **nginx** after recreating **frontend** so the reverse proxy picks up the new container IP (otherwise you may see HTTP 502).

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
