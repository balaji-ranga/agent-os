# Agent OS — OpenClaw Agent Space

Web platform for OpenClaw agents: org chart, human–agent chat (via OpenClaw gateway), and workspace MD file management (SOUL.md, AGENTS.md, MEMORY.md). Metadata is stored in a **lightweight SQLite** database.

## Interface: OpenClaw Gateway

The backend uses the [OpenClaw Gateway](https://docs.openclaw.ai/gateway) HTTP API:

- **Chat:** `POST /v1/chat/completions` (OpenAI-compatible)
  - Auth: `Authorization: Bearer <token>`
  - Agent: `x-openclaw-agent-id: main` (or agent id)
  - Session: `user` in body for stable session (per-agent, per-user)
- Enable in OpenClaw config: `gateway.http.endpoints.chatCompletions.enabled: true`
- Default gateway port: **18789**

## Prerequisites

- **Node.js 18+**
- **OpenClaw** installed and (for chat) **gateway** running with chat completions enabled
- **Workspace path** where SOUL.md, AGENTS.md, MEMORY.md live (for MD editor)
- **OPENAI_API_KEY** in backend `.env` for **Run COO** (standup + CEO summary via OpenAI). Optional: `OPENAI_COO_MODEL` (default `gpt-4o-mini`).
- Optional: **STANDUP_CRON_SCHEDULE** (cron expression, e.g. `0 9 * * *` for 9 AM daily) to run standup collection and COO automatically.
- Optional: **DELEGATION_CRON_SCHEDULE** (default `* * * * *` = every minute) — processes queued COO→agent messages and posts response callbacks to the standup so the COO never blocks on agent replies.
- Optional: **AGENT_OS_BASE_URL** or **PUBLIC_URL** — base URL where the backend is reachable (for cron webhook callbacks). Defaults to `http://127.0.0.1:3001`.
- Optional: **AGENT_OS_DATA_DIR** — directory for SQLite DB (default: `backend/data`).

## Quick start

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set OPENCLAW_WORKSPACE_PATH and OPENCLAW_GATEWAY_TOKEN (if gateway uses auth)
npm install
# On Windows, if npm install fails on better-sqlite3 (EPERM), run in a normal terminal or with elevated permissions.
npm run dev
```

Backend runs at **http://127.0.0.1:3001**. Health: `GET /health`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at **http://127.0.0.1:3000** and proxies `/api` to the backend.

### 3. OpenClaw gateway (for chat)

**Requirement:** Node.js **22.12.0 or newer** (OpenClaw CLI checks this). Upgrade from [nodejs.org](https://nodejs.org) if needed.

OpenClaw is installed globally (`npm install -g openclaw@latest`). A config with **chat completions enabled** is at `~/.openclaw/openclaw.json` (created for you). To recreate or customize, copy from `agent-os/openclaw-config.example.json`.

Start the gateway:

```bash
openclaw setup          # first time only: bootstrap workspace
openclaw gateway --port 18789
```

Set in backend `.env`:

- `OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789`

**Setting up OpenClaw from scratch:** Run `.\scripts\setup-openclaw-from-scratch.ps1` from the `agent-os` folder. It bootstraps OpenClaw, seeds the DB (all agents + ExpenseManager), installs agent-send and content-tools skills and extension, applies `openclaw.json` (agents, plugins, Ollama), ensures workspace templates (SOUL/MEMORY) and COO AGENTS.md, and ensures agent dirs. Then run `openclaw gateway --port 18789` and start backend + frontend.
- `OPENCLAW_GATEWAY_TOKEN=<your gateway token or password>` (if you set `gateway.auth` in OpenClaw config)

## What’s included

| Feature | Description |
|--------|-------------|
| **Dashboard** | List agents (org chart); add agent; open **Chat** per agent. |
| **Chat** | 1:1 chat with an OpenClaw agent via gateway; session affinity per agent; history stored in SQLite. |
| **Workspace** | View/edit SOUL.md, AGENTS.md, MEMORY.md (and optional daily `memory/*.md`). Backups on save. |
| **DB** | SQLite in `backend/data/agent-os.db`: agents (with `workspace_path`), activities, chat_turns, standups, standup_responses, standup_messages, agent_delegation_tasks, delegation_callbacks, content_tool_logs. |
| **Agent memory** | Backend injects each agent’s MEMORY.md into delegation prompts and appends a one-line summary when a task completes (cron callback and process-delegations). Workspace path comes from DB per agent. |

## API (backend)

- `GET /health` — liveness
- `GET /workspace/files` — list MD files
- `GET /workspace/files/:name` — read file (e.g. `soul`, `agents`, `memory`)
- `PUT /workspace/files/:name` — write file (body: `{ "text": "..." }`)
- `GET /agents` — list agents
- `POST /agents` — create agent
- `GET /agents/:id` — get agent
- `PATCH /agents/:id` — update agent
- `DELETE /agents/:id` — delete agent
- `GET /agents/:id/chat` — chat history
- `POST /agents/:id/chat` — send message (body: `{ "message": "..." }`) → gateway → reply
- `GET /agents/:id/activities` — activity log
- `POST /agents/:id/activities` — append activity
- All API routes are under **`/api`** (e.g. `/api/standups`, `/api/cron`). The frontend uses `VITE_API_URL` or proxy to `/api`.
- `GET /api/standups` — list standups (query: `?limit=50`)
- `GET /api/standups/:id` — get standup with responses and messages
- `POST /api/standups` — create standup (body: `{ "scheduled_at": "...", "status": "scheduled" }`)
- `PATCH /api/standups/:id` — update standup (coo_summary, ceo_summary, status)
- `POST /api/standups/:id/responses` — add response (body: `{ "agent_id": "...", "content": "..." }`)
- `POST /api/standups/:id/run-coo` — generate COO + CEO summary via OpenAI (requires `OPENAI_API_KEY` in backend `.env`)
- `POST /api/cron/run-standup` — run standup flow now: create standup, collect status from agents (OpenClaw), run COO. Can be triggered manually from the Dashboard.
- `POST /api/cron/process-delegations` — aggregate completed delegation batches and post COO callback messages to standups (e.g. after OpenClaw cron webhooks have updated tasks).
- **Standup chat with COO:** `POST /api/standups/:id/messages` with `{ content }` — chat with the COO agent (OpenClaw). With `{ action: 'get_work_from_team' }` — **OpenClaw Gateway cron** is used: one one-shot job per agent is created via the Gateway's `/tools/invoke` (cron_add); each job runs the agent and POSTs the result to `POST /api/standups/cron-callback`. The backend then posts a COO message to the standup with the team's responses. **Check for updates** calls `POST /api/cron/process-delegations` to aggregate any completed batches. Set `AGENT_OS_BASE_URL` (or `PUBLIC_URL`) if the backend is not at `http://127.0.0.1:3001` so the webhook URL is reachable by the Gateway. Deep research: `{ action: 'request_research', content: '...' }` queues one task; same callback pattern.

## Restart and test

After code changes, restart backend (and frontend / gateway if needed). Then run:

```bash
cd backend && npm run test:smoke   # quick: health, agents, standups
cd backend && npm run test:full    # full: create agent, standups, workspace MD, chat (set SKIP_CHAT=1 if gateway not running)
```

See **knowledgebase/TESTING.md** for full test cases (including frontend manual tests) and restart steps.

## Database and scripts

- **Schema and init:** `backend/src/db/schema.js` — creates all tables, `initDb()`, `getDb()`. DB file: `backend/data/agent-os.db` (or `AGENT_OS_DATA_DIR` in `.env`).
- **Default seed:** `backend/src/db/seed-default-agents.js` — seeds default agents.
- **Seed and utility scripts (use the DB):** `backend/scripts/` — e.g. `seed-all.js`, `seed-balserve.js`, `seed-techresearcher.js`, `seed-expenses.js`, `create-openclaw-agent.js`, `clear-schedules.js`, `ensure-techresearcher.js`, `ensure-coo-workspace.js`, `check-content-logs.js`, `start-gateway-with-env.js`.
- **OpenClaw and workspace scripts (repo root):** `scripts/` — e.g. **`setup-openclaw-from-scratch.ps1`** (full setup: agents, skills, config, workspaces), `apply-openclaw-agents-config.js`, `ensure-all-agent-workspaces.js`, `fix-openclaw-ollama-models.js`, `ensure-openclaw-agent-dirs.js`, `restart-and-test.ps1`, `apply-openclaw-agents-and-restart.ps1`.

No separate migration folder; schema changes are in `schema.js` (with optional `ALTER TABLE` blocks for existing DBs).

## Project layout

```
agent-os/
├── README.md
├── knowledgebase/           # Docs: TESTING, GITHUB-SETUP, IMPLEMENTATION_PLAN, AGENT_REVIEW_AND_SKILLS, CONFIGURE-CLAUDE-OPUS (see knowledgebase/README.md)
├── scripts/                    # OpenClaw/workspace scripts (apply config, ensure workspaces, fix Ollama models)
├── openclaw-workspace-templates/  # SOUL.md, MEMORY.md (and AGENTS.md) per agent type
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── data/                   # SQLite DB: agent-os.db (or AGENT_OS_DATA_DIR)
│   ├── scripts/                # DB seeds and utilities (seed-all, seed-*, ensure-*, clear-schedules, etc.)
│   └── src/
│       ├── index.js
│       ├── db/
│       │   ├── schema.js       # DB init, table definitions, getDb
│       │   └── seed-default-agents.js
│       ├── workspace/adapter.js
│       ├── gateway/openclaw.js
│       ├── services/delegation-queue.js, standup-delegate.js, coo.js
│       └── routes/workspace.js, agents.js, standups.js, openclaw.js, tools.js
└── frontend/
    ├── package.json
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api.js
        └── pages/Dashboard.jsx, Workspace.jsx, AgentChat.jsx
```

## Documentation (knowledge base)

All project docs except this README live in **`knowledgebase/`**: testing, GitHub setup, implementation plan, agent/skills review, OpenClaw model config. See **knowledgebase/README.md** for the index. Cursor and other tools can refer to `knowledgebase/` for context.

## License

Same as parent project.
