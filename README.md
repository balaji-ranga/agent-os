# Flowlah — An Agent Company Setup

**Flowlah (Automate, Innovate, Elevate)** is a web platform for running an AI agent company on [OpenClaw](https://docs.openclaw.ai/gateway): org-aware agents, human–agent chat, workspace MD management (`SOUL.md`, `AGENTS.md`, `ORG.md`, `MEMORY.md`, `TOOLS.md`), **custom visual workflows**, **AgentExchange (A2A)**, **Job Applicant pipeline**, **MCP integrations**, Kanban, standups, content tools, and multi-tenant CEO isolation. Metadata is stored in a **lightweight SQLite** database.

> Browser tab title: **Flowlah - An Agent Company Setup**. Login footer: **Flowlah (Automate, Innovate, Elevate)**.

When you register as a CEO, Flowlah automatically sets up your standard agents (including **Platform Help** and **Workflow Builder**), a starter **departments** list, the **Flowlah User Guide** (this README), and the full **Platform Help** document set in Master Data so agents can look them up via RAG.

---

## Using Flowlah — guide for CEOs (from the UI)

This section is a short overview. For the complete end-user guide (navigation, every workflow node, input/output mapping, MCP, A2A, Job pipeline, troubleshooting), use:

- **In-app:** chat with the **Platform Help** agent (`platformhelp`) — it searches Master Data help docs with `master_data_rag`.
- **Docs:** [`knowledgebase/platform-help/`](knowledgebase/platform-help/README.md) (source of truth uploaded into each CEO’s Master Data on register/startup).

You do not need to know APIs or Docker for everyday use.

### Sign in and first look

1. Open the Flowlah site and **Log in** (or **Register** if you are new).
2. After login you land on the **Dashboard** — your org chart of agents (COO and specialists).
3. The **bell** in the top bar is your notification center (agent replies and messages pushed to you).

### Chat with an agent

1. On the **Dashboard**, click an agent (or open **Chat**).
2. Type your request in plain language and send.
3. When the agent uses tools (Master Data, notify you, email, etc.), small **tool icons** may appear under the reply so you can see what it did.
4. Prefer asking the **COO** for work that should be planned or handed to a specialist (research, applications, etc.).

### Ask Platform Help (how-to)

1. Open **Chat** with **Platform Help** (Dashboard org chart or Agent Workspaces).
2. Ask in plain language (“How do I register an MCP server?”, “What does the IF node output?”).
3. The agent searches your Master Data **Flowlah Help — …** documents and answers with UI steps.
4. For *building* or *repairing* a workflow graph, prefer **Workflow Builder**; for standups/delegation, prefer the **COO**.

### Ask the COO to delegate specialty work

1. Open **Chat** with your **COO**.
2. Describe the outcome you want (for example: research a topic, draft something, check company data).
3. The COO matches your ask to the right specialist using each agent’s purpose (from org docs), starts a Kanban card, and tracks the work.
4. Watch progress on **Kanban**; when something is ready for you, check the **bell**.

Tips:
- One clear request works best (“Research X and summarize findings”).
- Vague “help me” messages may stay with the COO instead of going to a specialist.
- COO-native asks (workflows, tools, Kanban, standups) usually stay with the COO.

### Broadcast to several agents

1. Open **Broadcast** from the navigation.
2. Write a message to send to multiple agents (for example a status check or announcement).
3. If you want each agent to **notify you** when they finish (bell), say so clearly in the message (e.g. “report status and notify me”).
4. Review results in agent chats and in the **bell**.

### Notifications (bell)

1. Click the **bell** to see recent items (platform alerts and agent responses).
2. Hover a short snippet to read the **full** title or message.
3. Open the linked chat when you want to continue the conversation.
4. Use **Clear** / dismiss to tidy items you have already handled.

### Master Data (tables) and documents (RAG)

1. Open **Master Data**.
2. **Tables** — structured lists (rows and columns). Your account starts with a **departments** table (Executive, Research, Finance, and so on). Add or edit departments here; they appear when you assign agents to a department.
3. **Documents** — upload files your agents can search (policies, guides, handbooks). New accounts include this **Flowlah User Guide** plus the **Platform Help** set (`Flowlah Help — …`) so agents (especially Platform Help) can answer product how-to questions.
4. When you chat with an agent that has Master Data tools, ask in plain language (“list departments”, “what does our PTO policy say?”, “how do I publish A2A?”).

### Org chart and Resync

1. On the **Dashboard**, review who reports to whom.
2. After you add, rename, or reorganize agents, use **Resync ORG.md & AGENTS.md** so every agent’s org docs stay current (who the CEO is, peers, and who the COO may delegate to).
3. Open an agent’s **Workspace** to review or edit personality and tool instructions (`SOUL`, `AGENTS`, `TOOLS`, etc.).

### Kanban and standups

1. **Kanban** — board of tasks by agent and status. Open a card for detail, artifacts, and task chat.
2. **Standups** — team check-ins with COO chat. Daily standups can also run on a schedule when configured by your admin.
3. Tasks created when the COO delegates appear on the board so you can track specialty work end to end.

### Workflows and AgentExchange

1. **Workflows** — build visual automations (triggers, agents, APIs, approvals). Publish a run and watch it on Kanban.
2. **Publish as A2A** from a workflow if you want it listed for others.
3. **AgentExchange** — browse published workflow agents across the platform.

### Job search pipeline (optional)

1. Set up a **Job profile** with preferences and resume context.
2. Use **Job workflows** for discovery → scoring → tailoring → application, tracked on Kanban.
3. Review candidates and applications in the Job UIs when the pipeline finds matches.

### Tools, email, and “notify me”

Agents you grant tools to can:
- Send email (when mail is configured for your environment)
- **Notify you** in the bell (`notify_ceo`)
- Read/update Master Data and search documents
- Move Kanban cards and trigger workflows (when allowed)

Grant or revoke tools on each agent’s **Workspace → Tools access**.

### Profile and AI model

1. Open your **Profile**.
2. Choose how the platform picks models (platform default, your API key, or local options like DeepSeek on Ollama when available).
3. Keep MFA settings as required by your organization.

---

## What’s new (recent product highlights)

| Area | What you get in the UI |
|------|-------------------------|
| **Platform Help agent** | Dedicated `platformhelp` agent + Master Data help corpus (`knowledgebase/platform-help/`) via keyword RAG. |
| **COO specialty routing** | COO chat routes specialty asks using agent purposes (org docs), not guesswork keywords. |
| **Broadcast + notify** | Broadcast can ask agents to report back and ping your bell; quieter when you only want a rollup. |
| **Master Data + document search** | Tables with purposes; documents agents can search; starter **departments** + User Guide + Platform Help docs on register. |
| **Chat tool icons** | See which tools an agent used under a reply. |
| **Notification tooltips** | Hover the bell snippet for the full message. |
| **Tenant Workspace docs** | Your CEO workspace files stay in your space; Resync keeps ORG/AGENTS accurate. |
| **Shared notification dismiss** | Clear/dismiss keeps the bell feed tidy across platform + agent items. |

---

## Interface: OpenClaw Gateway

The backend uses the [OpenClaw Gateway](https://docs.openclaw.ai/gateway) HTTP API:

- **Chat:** `POST /v1/chat/completions` (OpenAI-compatible)
  - Auth: `Authorization: Bearer <token>`
  - Agent: `x-openclaw-agent-id: main` (or agent id)
  - Session: `user` in body for stable session (per-agent, per-user)
- Enable in OpenClaw config: `gateway.http.endpoints.chatCompletions.enabled: true`
- Default gateway port: **18789**
- **Per-CEO tenants:** each CEO gets isolated OpenClaw agent runtimes and workspaces (`openclaw-tenant`); prompts are tagged with `owner_user_id` / `ceo_user_id`.

## Prerequisites

- **Node.js 18+** (Node **22.12+** for OpenClaw CLI)
- **OpenClaw** installed and (for chat) **gateway** running with chat completions enabled
- **Workspace path** where SOUL.md, AGENTS.md, MEMORY.md live (for MD editor)
- **OPENAI_API_KEY** in backend `.env` for **Run COO** (standup + CEO summary via OpenAI). Optional: `OPENAI_COO_MODEL` (default `gpt-4o-mini`).
- Optional: **STANDUP_CRON_SCHEDULE** (cron expression, e.g. `0 9 * * *` for 9 AM daily) — runs standup **per enabled CEO** (isolated standups + owner-scoped prompts).
- Optional: **DELEGATION_CRON_SCHEDULE** (default `* * * * *` = every minute) — processes queued COO→agent tasks **per CEO** (each CEO worker only picks that CEO’s tasks) and posts response callbacks to the correct standup.
- Optional: **JOB_PIPELINE_CRON_SCHEDULE** — Job Applicant pipeline tick across CEO profiles.
- Optional: **AGENT_OS_BASE_URL**, **AGENT_OS_PUBLIC_URL**, or **PUBLIC_URL** — public DNS/HTTPS base URL for workflow event hooks, cron webhooks, A2A cards, and artifact links. Defaults to `http://127.0.0.1:3001` for local dev.
- Optional: **AGENT_OS_DATA_DIR** — directory for SQLite DB (default: `backend/data`).
- Optional: **AGENT_OS_ADMIN_EMAIL** / **AGENT_OS_ADMIN_PASSWORD** — platform admin seeded on first startup.
- Optional: **AGENT_OS_BALA_CEO_*** — default CEO user for legacy job profiles and workflows.

## Quick start

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set OPENCLAW_WORKSPACE_PATH, OPENCLAW_GATEWAY_TOKEN, OPENAI_API_KEY
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

Frontend runs at **http://127.0.0.1:3000** and proxies `/api` to the backend (override with `VITE_API_PROXY_TARGET` in dev; set `VITE_API_URL` for production builds).

### 3. Log in

Open **http://127.0.0.1:3000/login**. Default admin is seeded from `.env` (`AGENT_OS_ADMIN_*`). CEO users see Dashboard, Workflows, Kanban, Job profiles, AgentExchange, etc. Admin users manage platform accounts and MCP registry. New CEOs register at `/register` and get provisioned OpenClaw agents, org context, starter **departments**, and this README as a Master Data document.

### 4. OpenClaw gateway (for chat)

OpenClaw is installed globally (`npm install -g openclaw@latest`). A config with **chat completions enabled** is at `~/.openclaw/openclaw.json` (copy from `agent-os/openclaw-config.example.json`).

Start the gateway:

```bash
openclaw setup          # first time only: bootstrap workspace
openclaw gateway --port 18789
```

Set in backend `.env`:

- `OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789`
- `OPENCLAW_GATEWAY_TOKEN=<your gateway token or password>` (if you set `gateway.auth` in OpenClaw config). **If you see "gateway closed (1008): pairing required"**, see **knowledgebase/GATEWAY-PAIRING-1008.md**.

**Setting up OpenClaw from scratch:** Run `.\scripts\setup-openclaw-from-scratch.ps1` from the `agent-os` folder. It bootstraps OpenClaw, seeds the DB (all agents + ExpenseManager), installs agent-send and content-tools skills and extension, applies `openclaw.json` (agents, plugins, Ollama), ensures workspace templates (SOUL/MEMORY/TOOLS) and COO AGENTS.md, and ensures agent dirs. Then run `openclaw gateway --port 18789` and start backend + frontend.

## What’s included

| Feature | Description |
|--------|-------------|
| **Auth & roles** | Login/register; **admin** (user management, MCP registry) and **ceo** (agents, workflows, kanban, job pipeline). JWT sessions. New CEO registration provisions OpenClaw agents, syncs org context, seeds **departments** + default **User Guide** document. |
| **Multi-tenant isolation** | Standups and delegation tasks carry `owner_user_id`. Standup cron and delegation cron loop **per enabled CEO** so one CEO never sees another’s standups, chats, or queued agent work. APIs filter by authenticated CEO. |
| **Org-aware agents** | Every agent in a CEO’s org gets **ORG.md** (CEO, departments, peers with soul/purpose/skills) plus a tenant-specific COO **AGENTS.md** (delegatees). Synced on provision, agent create, and backend startup. Bootstrap watcher reloads `ORG.md` each turn. |
| **Dashboard** | List agents (org chart); add agent; open **Chat** per agent; standups with COO chat (owner-scoped only); **Resync ORG.md & AGENTS.md**. |
| **Chat** | 1:1 chat with an OpenClaw agent via gateway; session affinity per agent; history stored in SQLite; **tool-call icons** on assistant replies when Agent OS tools ran. |
| **Agent workspace** | Per-agent **SOUL.md, AGENTS.md, ORG.md, MEMORY.md, TOOLS.md** editor (tenant path for signed-in CEO); **Tools access** panel (grant/revoke content tools per agent, hot-sync to OpenClaw without gateway restart). |
| **Notifications** | **Bell icon** in nav: agent responses + platform notifications; hover for full text; link to agent Chat; clear/dismiss (shared feed). |
| **Kanban** | Board view (tasks by agent and status); task detail with **task chat**, artifacts, workflow run links. Reopen task; create task (COO or direct to agent). Auto-completes when COO chat delegations finish. |
| **Custom workflows** | Visual **Workflows** editor: trigger (manual / schedule / chat / event webhook), agent, API, MCP tool, **SSE listen**, **sub-workflow**, Brain (LLM + optional MCP tool calling), email, IF/While, parallel/merge, CEO approval, **external agent (A2A)**. Publish, run instances, paginated run history, search, **stop SSE listen** on active runs. |
| **Publish as A2A** | From the workflow editor, **Publish A2A** exposes a workflow as an A2A-compliant agent (agent card + JSON-RPC endpoint). Unpublish removes it from AgentExchange. |
| **AgentExchange** | Browse all published A2A workflow agents across the platform (`/agent-exchange`). Public cards at `/a2a/:publishId/.well-known/agent-card.json`. |
| **Workflow Builder chat** | LLM assistant in the workflow editor to create/edit graphs via natural language. |
| **Job profiles** | CEO job search profiles (intake, resume, preferences); gate for Job Applicant pipeline. |
| **Job workflows** | Multi-agent **Job Applicant** pipeline (Discovery → Fit Scoring → Resume Tailoring → Application); Kanban-tracked stages; browser/Playwright apply path. See **knowledgebase/JOB-APPLICANT-WORKFLOW.md**. |
| **MCP integrations** | Register MCP servers (admin/CEO); connect, test tools, playground; use in workflow **MCP Tool** and **SSE Listen** nodes. Local test server: `tools/local-mcp-random-sse/`. |
| **External agents (A2A)** | Register external agent endpoints; invoke from workflow **External Agent** node. |
| **Content tools** | Agent-callable tools: summarize URL, image/video gen, Kanban, **intent_classify_and_delegate**, workflow trigger/enquire/mutate, job applicant tools, **email_send**, **notify_ceo**, **Master Data** (`master_data_list_tables` / row CRUD / `master_data_rag`), learnings, browser, etc.; owner-scoped logs UI; onboard new APIs via script. |
| **Master Data & RAG** | Per-CEO tables + documents (keyword RAG). UI captures **purpose/description** per table. Agents list tables with purpose and CRUD rows / RAG docs via content tools — **no create/alter/drop table**. On register: starter **departments** table + **Flowlah User Guide** + **Platform Help** document set. |
| **Platform Help** | Standard agent `platformhelp` — product how-to via `master_data_rag` over `knowledgebase/platform-help/`. See [`knowledgebase/platform-help/README.md`](knowledgebase/platform-help/README.md). |
| **COO specialty delegation** | COO chat hard-path: AGENTS.md purpose intent → specialist (cap 1) + Kanban; peer specialty referral; COO-native work stays with COO; how-to → Platform Help; graph build → Workflow Builder. |
| **Email send** | `email_send` content tool — agents can send email via configured mail integration (owner-scoped logging). |
| **Notify CEO** | `notify_ceo` content tool — agents push a platform notification to their CEO (bell feed). |
| **Broadcast** | Send messages to multiple agents; LLM intent for status+notify; paced fan-out; exclude COO by default. |
| **Tools onboarding** | Script `scripts/onboard-api-tool.js` onboards a new API as a tool from JSON (updates DB, OpenClaw tool list). See `scripts/tool-definitions/README.md`. |
| **Workspace (legacy MD)** | Global workspace MD editor (older path); prefer **Agent workspace** per agent. |
| **DB** | SQLite: agents, users, chat, standups (`owner_user_id`), delegations (`owner_user_id`), kanban, content tools, job profiles/applications, MCP servers, agent workflow definitions/runs, A2A publications, external agents, platform notifications, audit. |
| **Agent memory** | Backend injects each agent’s MEMORY.md into delegation prompts and appends summaries on task completion (tenant workspace path). |

### Multi-tenancy & schedulers (high level)

| Scheduler | Behavior |
|-----------|----------|
| **Standup cron** | For each enabled CEO: create standup with `owner_user_id`, run COO collection with owner tags. |
| **Delegation cron** | For each enabled CEO: claim only that CEO’s `pending` `agent_delegation_tasks`, run agents in that CEO’s OpenClaw tenant, post callbacks only for that CEO’s request IDs. |
| **Job pipeline cron** | Ticks job profiles / pipeline stages (see Job Applicant docs). |

New CEOs start with **empty** standups (no other user’s chats or agents), starter Master Data (**departments** + User Guide document). Dashboard does not auto-open another CEO’s standup.

### Custom Agent Workflows (high level)

- **Editor:** `/workflows` → create from template or blank → `/workflows/:id/edit`
- **Triggers:** manual, cron schedule, chat phrase, **event webhook** (hook URL on Start node when event mode enabled; uses `AGENT_OS_BASE_URL`)
- **Node types:** Trigger, Agent, Content Tool, MCP Tool, **SSE Listen** (long-running stream; dispatches downstream on each event), **Sub-workflow**, Call API (Basic/Bearer/API-key auth + custom headers), Brain, Email, IF, While, Parallel, Merge, CEO Approval, External Agent
- **Data binding:** `{{nodeId.outputKey}}` templates; nested JSON paths (e.g. `{{api-1.body.users.0.name}}`)
- **A2A publish:** Publish → AgentExchange + public agent card / JSON-RPC under `/a2a/:publishId`
- **Runs:** Kanban tasks per step; fail run on API/MCP errors (non-2xx HTTP, SSL errors, MCP `is_error`)
- **Tests:** `node backend/scripts/test-sse-workflow.js`, `node backend/scripts/demo-sse-hook-and-listen.js`

### Job Applicant vs Custom Workflows

| | **Job workflows** (`/job-workflows`) | **Workflows** (`/workflows`) |
|--|--------------------------------------|------------------------------|
| Purpose | Fixed multi-agent job search/apply pipeline | User-defined graphs |
| Orchestration | COO + specialist agents + pipeline cron | Backend workflow runner |
| Setup | `node scripts/setup-job-applicant-agents.js` | UI or Workflow Builder chat |

### Tools access vs TOOLS.md

- **Tools access** (Workspace UI): enforcement — which Agent OS tools OpenClaw exposes to the agent (`agent_tool_grants`, `~/.openclaw/agent-tool-allowlists.json`).
- **TOOLS.md**: instructions for the LLM — when and how to use granted tools. Sync from template via Workspace UI.
- **COO defaults:** if a COO has no grants, backend applies `COO_CONTENT_TOOLS_ALLOW` (includes delegation, Kanban, `email_send`, `notify_ceo`).

### Hosting / DNS

For production, set in backend `.env`:

```env
AGENT_OS_BASE_URL=https://your-domain.example
```

For frontend production build:

```env
VITE_API_URL=https://your-domain.example/api
```

Workflow hook URLs, cron webhooks, A2A cards, and MCP/API endpoints in graphs should use your public DNS — not `127.0.0.1`. See `backend/.env.example` and `deploy/.env.example`.

## Production deploy (Docker / Podman)

Container stack: **nginx** + **frontend** + **backend** + **OpenClaw gateway**, with optional **init**, **Ollama**, **MCP / OpenConnector mock**, and **browser-login** profiles.

```bash
cd deploy
cp .env.example .env   # set AGENT_OS_PUBLIC_URL, OPENCLAW_GATEWAY_TOKEN, OPENAI_API_KEY
./scripts/up.sh        # auto-fills TOOLS_API_KEY + AGENT_OS_INTERNAL_TOKEN; USE_PODMAN=1 on CentOS
```

Laptop sync (when VPS cannot `git pull`):

```powershell
.\deploy\scripts\sync-to-vps.ps1
.\deploy\scripts\sync-to-vps.ps1 -Services backend
```

- **deploy/README.md** — Compose services, volumes, profiles, OpenConnector / email-inbound, repeatable sync
- **knowledgebase/DEPLOY-CENTOS-PODMAN.md** — CentOS, Podman, SELinux, Chromium/browser login
- **scripts/setup-openclaw-from-scratch.sh** — Linux bootstrap (also runs in the `init` container)

## Tools onboarding (script)

Create a JSON file in `scripts/tool-definitions/` with `name`, `description`, `endpoint`, `method`, optional `api_key_bearer`, and `applicable_agents`. Run from the `agent-os` folder:

```bash
node scripts/onboard-api-tool.js scripts/tool-definitions/your-tool.json
```

Restart the OpenClaw gateway. See `scripts/tool-definitions/README.md`.

## API (backend)

All routes below are also available under **`/api/...`** (frontend uses `/api` proxy or `VITE_API_URL`).

### Core

- `GET /health` — liveness
- **Auth:** `POST /auth/login`, `POST /auth/register`, `GET /auth/me`, profile update
- **Admin:** `GET/POST /admin/users`, enable/disable users, grant agents

### Agents & workspace

- `GET/POST /agents` — agent CRUD
- `GET/POST /agents/:id/chat` — chat history and send message (→ gateway)
- `GET/PUT /agents/:id/workspace/:file` — soul, agents, **org**, memory, tools MD
- `GET/PUT /agents/:id/tools` — per-agent content tool grants

### Standups, Kanban, cron

- `GET/POST/PATCH/DELETE /standups`, `/standups/:id/messages`, `/standups/:id/run-coo` — **owner-scoped**
- `GET /standups/notifications` — bell feed (delegation responses for this CEO)
- `GET/PATCH /kanban/tasks`, task messages, reopen, artifacts
- `POST /cron/run-standup`, `POST /cron/process-delegations` — standup per CEO; delegations per CEO
- `GET /platform-notifications` — CEO notify feed (`notify_ceo`)

### Content tools

- `GET /tools/meta`, `POST /tools/invoke`, workflow chat tools (`agent_workflow_*`), job applicant tools
- `POST /tools/intent-classify-and-delegate` — COO delegation (stamps `owner_user_id` on standup/tasks)
- `POST /tools/...` — `email_send`, `notify_ceo`, Kanban helpers, etc. (owner resolved from auth / tenant, not spoofable body ids)

### Job applicant

- `/job-applicant/*` — profiles, applications, pipeline runs, browser auth, CEO review. See **knowledgebase/JOB-APPLICANT-WORKFLOW.md**.

### Custom agent workflows

- `GET/POST/PATCH/DELETE /agent-workflows` — definitions, publish, audit
- `POST /agent-workflows/:id/run` — start run
- `GET /agent-workflows/runs` — paginated runs (`?page=&limit=&q=`)
- `POST /agent-workflows/runs/:runId/listen/:nodeId/stop` — stop SSE listen
- `POST /agent-workflows/hooks/:definitionId` — event trigger (webhook secret header)
- `POST /agent-workflows/agent-chat` — Workflow Builder LLM
- `POST /agent-workflows/approval/respond` — CEO approval from Kanban
- **A2A publish:** publish / unpublish workflow as A2A agent (used by Publish A2A modal)

### AgentExchange & public A2A

- `GET /agent-exchange` — list all published A2A workflow agents
- `GET /a2a/:publishId/.well-known/agent-card.json` — public agent card
- `POST /a2a/:publishId` — A2A JSON-RPC invoke

### MCP & external agents

- `/integrations/mcp/*` — MCP server registry, connect, test, call tool
- `/external-agents/*` — A2A agent registry and task invoke

### Master Data

- `/master-data/*` — tables, rows, documents, RAG (per CEO). Default User Guide document + departments seeded on CEO register / backend startup backfill.

### Media

- `GET /media/openclaw/*` — proxied OpenClaw media for chat/kanban display

## Restart and test

```bash
cd backend && npm run test:smoke   # quick: health, agents, standups
cd backend && npm run test:full    # full suite (set SKIP_CHAT=1 if gateway not running)
node backend/scripts/test-sse-workflow.js   # SSE + workflow E2E (local MCP on 3099)
```

PowerShell helpers: `scripts/stop-and-restart-backend-frontend.ps1`, `scripts/stop-and-restart-gateway.ps1`, `scripts/stop-and-restart-all.ps1`.

See **knowledgebase/TESTING.md** for full test cases and restart steps.

## Database and scripts

- **Schema:** `backend/src/db/schema.js` — `initDb()`, `getDb()`. DB: `backend/data/agent-os.db` (or `AGENT_OS_DATA_DIR`). Includes `standups.owner_user_id`, `agent_delegation_tasks.owner_user_id`, A2A publications, platform notifications.
- **Seeds:** `seed-default-agents.js`, `seed-content-tools-meta.js` (email_send, notify_ceo, Kanban, workflow tools), `seed-job-applicant-tools.js`, `seed-workflow-builder-agent.js`, `seed-platform-help-agent.js`
- **Default CEO Master Data:** `backend/src/services/ceo-default-master-data.js` — departments table + Flowlah User Guide (README) + Platform Help docs (`knowledgebase/platform-help/`) on register and startup backfill
- **Backend scripts:** `backend/scripts/` — seeds, E2E tests, MCP seed, workflow tests, COO org/delegation smoke, `cleanup-workflow-runs.js`
- **OpenClaw scripts:** `scripts/` — `setup-openclaw-from-scratch.ps1`, `onboard-api-tool.js`, `apply-openclaw-agents-config.js`, `setup-job-applicant-agents.js`, `sync-browser-tools-md.js`, `install-agent-os-content-tools-extension.js`, kill/restart helpers
- **Allowlists:** `backend/src/lib/content-tools-allow.js` (Docker-safe; keep in sync with `scripts/lib/content-tools-allow.js`)

No separate migration folder; schema changes use `ALTER TABLE` blocks in `schema.js`.

## Project layout

```
agent-os/
├── README.md
├── knowledgebase/              # Extended docs (see index below)
├── scripts/                    # OpenClaw/workspace; onboard-api-tool.js; tool-definitions/
├── tools/local-mcp-random-sse/ # Dev MCP + SSE test server (port 3099)
├── openclaw-workspace-templates/  # SOUL, AGENTS, MEMORY, TOOLS, ORG per agent type
├── openclaw-skills/            # agent-send, agent-os-content-tools, etc.
├── openclaw-extensions/        # agent-os-content-tools plugin, bootstrap watcher (ORG.md)
├── deploy/                     # Docker Compose, nginx, sync-to-vps.ps1, up.sh
├── backend/
│   ├── .env.example
│   ├── data/                   # SQLite
│   ├── scripts/                # seeds, E2E, workflow tests
│   └── src/
│       ├── index.js            # standup + delegation + job pipeline crons
│       ├── config/             # llm, public-url, tools
│       ├── db/
│       ├── lib/                # content-tools-allow (COO / global / workflow builder)
│       ├── routes/             # auth, admin, agents, kanban, job-applicant,
│       │                         # agent-workflows, workflow-a2a, agent-exchange,
│       │                         # platform-notifications, mcp-integrations, …
│       ├── services/           # org-context, openclaw-tenant, delegation-queue,
│       │                         # email-send, notify-ceo, ceo-default-master-data, …
│       └── gateway/openclaw.js
└── frontend/
    └── src/
        ├── pages/              # Dashboard, Login (Flowlah footer), AgentChat,
        │                         # AgentWorkspace, Kanban, AgentWorkflows,
        │                         # AgentWorkflowEditor, AgentExchange, JobProfiles,
        │                         # JobWorkflows, MasterData, Broadcast, …
        └── components/         # NotificationBell, PublishA2AModal, ChatComposeInput,
                                # ChatToolCalls, workflow editor nodes, Kanban artifacts
```

## Documentation (knowledge base)

All project docs except this README live in **`knowledgebase/`**:

| File | Purpose |
|------|---------|
| **platform-help/** | CEO end-user Platform Help corpus (RAG source for Platform Help agent) |
| **TESTING.md** | Restart, API tests, frontend manual tests, smoke test |
| **JOB-APPLICANT-WORKFLOW.md** | Job pipeline agents, tools, profile intake, setup |
| **GATEWAY-PAIRING-1008.md** | Fix gateway pairing / token |
| **SESSION-HISTORY-VISIBILITY-TREE.md** | OpenClaw session visibility |
| **AGENT_REVIEW_AND_SKILLS.md** | Agent roles and skills |
| **CONFIGURE-CLAUDE-OPUS.md** | Anthropic model in openclaw.json |
| **IMPLEMENTATION_PLAN.md** | Roadmap and phases |
| **GITHUB-SETUP.md** | Push to GitHub |
| **SOCIAL_POSTING_OPTIONS.md** | SocialAssistant posting options |
| **ADD-AGENT-VS-RECENT-FIXES-VALIDATION.md** | Agent creation vs config scripts |
| **DEPLOY-CENTOS-PODMAN.md** | CentOS / Podman / Docker production |
| **OPENCONNECTOR-WEBHOOKS.md** | OpenConnector MCP, email-inbound, file pollers |
| **IBKR-TRADING-WORKFLOW.md** | IBKR paper trading workflow |
| **knowledgeGraph.md** | Neo4j knowledge graph / self-improvement |

See **knowledgebase/README.md** for the full index.

## License

Same as parent project.
