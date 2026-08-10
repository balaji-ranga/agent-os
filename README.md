# Flolah — AI Company OS

**Flolah (Automate, Innovate, Elevate)** is the **AI Company OS**: hire and run digital employees (AI workers) on [OpenClaw](https://docs.openclaw.ai/gateway) with org structure, human–AI chat, workspace identity docs, **custom visual workflows**, **AgentExchange (A2A)**, **Job Applicant pipeline**, **MCP integrations**, Kanban, standups, content tools, and multi-tenant CEO isolation. Metadata is stored in a **lightweight SQLite** database.

> **Messaging, terminology, and OS primitives:** [`knowledgebase/AI-COMPANY-OS.md`](knowledgebase/AI-COMPANY-OS.md)  
> Browser tab title: **Flolah — AI Company OS**. Login: **Sign in to run your AI company**.

When you register as a CEO, Flolah automatically sets up your standard AI employees (including **Platform Help** and **Workflow Builder**), a starter **departments** list, the **Flolah User Guide**, and the full **Platform Help** document set in Knowledge (Master Data) so employees can look them up via RAG.

---

## Using Flolah — guide for CEOs (from the UI)

This section is a short overview. For the complete end-user guide (navigation, every workflow node, input/output mapping, MCP, A2A, Job pipeline, troubleshooting), use:

- **In-app:** chat with the **Platform Help** agent (`platformhelp`) — it searches Master Data help docs with `master_data_rag`.
- **Docs:** [`knowledgebase/platform-help/`](knowledgebase/platform-help/README.md) (source of truth uploaded into each CEO’s Master Data on register/startup).

You do not need to know APIs or Docker for everyday use.

### Sign in and first look

1. Open **https://login.flolah.cloud** (or **Register** if you are new). Marketing site is **https://flolah.cloud**.
2. After login you land on **home chat** (`/`) with the **COO** selected by default. Switch agents from the **Chat with** picker. **History** and **Browser session** side panes start closed — use the icons next to **New chat** to open them. Org chart and standups are under **My Org** (`/org`).
3. The **bell** in the top bar is your notification center (agent replies and messages pushed to you).
4. **New CEOs** may open **Company setup** first (`/company-setup`, also avatar → **Company setup**) to pick company type, mission, DNA, team pack, and management style — or skip and finish later. Platform Help guide: `knowledgebase/platform-help/29-company-setup.md`.

### Company setup (first-run wizard)

1. Open **Profile menu → Company setup** or go to `/company-setup`.
2. Complete the funnel: company type → identity → mission → org DNA → preview AI employees → systems → management style → review → **Apply**.
3. Apply provisions departments / AI employees from a blueprint pack; you can re-run later to extend (does not wipe the existing org by default).
4. This is **not** the freeform **Onboarding Helper** page (`/onboarding`) — that is separate selective Apply chat (help doc **27**). Full Company setup FAQ: help doc **29**.

### Scheduled goals (recurring CEO prompts)

1. Open **Management → Scheduled goals** (`/scheduled-goals`), **or** ask the **COO** in plain language (examples: “Every weekday at 9, prepare market insights…” or “Every hour, check MAGS; notify me if down 2%”).
2. Each goal stores a prompt plus cadence (**hourly** / daily / weekdays / weekly), local time (for hourly only the **minute** of the hour is used), perpetual or end date, and target AI employee (default COO).
3. **Create** and **edit** on the page (Edit → Save changes), or via COO tools. **Pause** / **Delete** stops automatic fires and **survives backend restarts**; only **active** goals run. **Run now** fires immediately. Optional **Enrich with AI** on create/edit.
4. Platform master tick: `SCHEDULED_GOALS_CRON` (default every minute). CEO tools: `scheduled_goal_create|list|update|delete|run_now`. Full guide: `knowledgebase/platform-help/28-scheduled-goals.md`. Market-condition watches ≈ scheduled check + tools + `notify_ceo` (not a real-time tick feed).

### Chat with an agent

1. From home chat, pick an AI employee (COO is default) — or open **Chat** from **My Org** / **AI Employees**.
2. Type your request in plain language and send. Optionally **attach** files (paperclip) — documents/images/audio/video are stored under Knowledge and `inbound/attachments/`.
3. When the AI employee uses tools (Master Data, notify, email, generate image/TTS, market history, **native OpenClaw `browser`**, etc.), small **tool icons** may appear under the reply so you can see what it did. Replies render markdown (**bold**, lists, code, links). Generated media plays **inline** in the chat (you must be logged in).
4. Prefer asking the **COO** for work that should be planned or handed to a specialist (research, applications, etc.).
5. To reach an AI employee from **WhatsApp / Slack**, open that employee’s **Channels** wizard (see Platform Help **24**). WhatsApp **group chats are ignored by default** unless you enable groups there.

### Ask Platform Help (how-to)

1. Open **Chat** with **Platform Help** (home picker, My Org org chart, or AI Employees).
2. Ask in plain language (examples: “How do I register an MCP server?”, “How do scheduled goals work?”, “What is Company setup?”, “What does the IF node output?”).
3. The AI employee searches **Flolah Help — …** platform docs (OpenSearch RAG), including **Scheduled Goals** (**28**) and **Company Setup** (**29**).
4. For *building* or *repairing* a workflow graph, prefer **Workflow Builder**; for standups/delegation/recurring goals, prefer the **COO**.

### Ask the COO to delegate specialty work

1. Open **Chat** with your **COO**.
2. Describe the outcome you want (for example: research a topic, draft something, check company data).
3. The COO matches your ask to the right specialist using each AI employee’s purpose (from org docs), starts a Kanban card, and tracks the work.
4. Watch progress on **Kanban**; when something is ready for you, check the **bell**.

Tips:
- One clear request works best (“Research X and summarize findings”).
- Vague “help me” messages may stay with the COO instead of going to a specialist.
- COO-native asks (workflows, tools, Kanban, standups) usually stay with the COO.

### Broadcast to several AI employees

1. Open **Broadcast** from the navigation.
2. Write a message to send to multiple AI employees (for example a status check or announcement).
3. If you want each to **notify you** when they finish (bell), say so clearly in the message (e.g. “report status and notify me”).
4. Review results in chats and in the **bell**.

### Notifications (bell)

1. Click the **bell** to see recent items (platform alerts and agent responses).
2. Hover a short snippet to read the **full** title or message.
3. Open the linked chat when you want to continue the conversation.
4. Use **Clear** / dismiss to tidy items you have already handled.

### Master Data (tables) and documents (RAG)

1. Open **Master Data**.
2. **Tables** — structured lists (rows and columns). Your account starts with a **departments** table (Executive, Research, Finance, and so on). Add or edit departments here; they appear when you assign agents to a department.
3. **Documents** — upload files your agents can search (policies, guides, handbooks). New accounts include this **Flolah User Guide** plus the **Platform Help** set (`Flolah Help — …`) so agents (especially Platform Help) can answer product how-to questions.
4. When you chat with an agent that has Master Data tools, ask in plain language (“list departments”, “what does our PTO policy say?”, “how do I publish A2A?”).
5. Documents: upload **PDF, Word (.docx), Excel, or text** — content is extracted for keyword RAG. Reindex older office uploads from the Documents panel if needed.
6. **Purge all uploads** (Documents panel) permanently deletes your uploaded files from the database and disk. **Platform Help** (`Flolah Help — …`) and the **Flolah User Guide** are protected — they cannot be deleted or purged (startup re-seeds them if missing).

### Org chart and Resync

1. On the **Dashboard**, review who reports to whom.
2. After you add, rename, or reorganize agents, use **Resync ORG.md & AGENTS.md** so every agent’s org docs stay current (who the CEO is, peers, and who the COO may delegate to).
3. Open an agent’s **Workspace** to review or edit personality and tool instructions (`SOUL`, `AGENTS`, `TOOLS`, etc.).

### Kanban and standups

1. **Kanban** — board of tasks by agent and status. Open a card for detail, artifacts, and task chat.
2. **Standups** — team check-ins with COO chat. Daily standups can also run on a schedule when configured by your admin.
3. Tasks created when the COO delegates appear on the board so you can track specialty work end to end.
4. **Run status checker** (Dashboard) — opens an HTML CEO report of what needs attention: cards awaiting you, **every failed card with its failure reason** and A2A / workflow run ids, plus recent completions. The same report is posted to your standup and emailed to you daily.

### Workflows and AgentExchange

1. **Workflows** — build visual automations (triggers, agents, APIs, approvals). Publish a run and watch it on Kanban.
2. **Publish as A2A** from a published workflow to list it for others:
   - **Visibility:** **Public** (default — listed on AgentExchange) or **Private** (public calling disabled; only COO or the org reports-to lead can invoke after **Add to org**; hidden from other CEOs).
   - **Invoke mode:** **Sync** (HTTP holds until the run finishes, ~2 min cap) or **Async** (immediate `working` + `task.id`; poll with **`enquire-progress`** / `tasks/get`, or receive a **callback URL** webhook when the run completes/fails/cancels). Final step text: enquire/sync → **`result.parts[0].text`**; callback webhook → **`final_output`**.
   - **Callback URL** at publish time, or per-invoke override via `params.metadata.callbackUrl` (plain JSON webhook — not A2A JSON-RPC).
   - **Access (IP):** new listings default to **Deny all** (card, invoke, OAuth token, and enquiry return `403` until you open access). Switch to **Allow all** or an **IP whitelist** under **AgentExchange → ⋯ → Security** (ignored while Visibility is Private). IP entries are owner-scoped in the **central IP whitelist** (also **Settings → IP Whitelists**).
   - **Auth:** **Public auth** (no token) or **Secured** (OAuth `client_id` + `client_secret` → Bearer access token; secret shown once). **Publish as new agent** or update an existing listing with `publish_id`.
3. **AgentExchange** — browse published workflow agents (Public / Private / Secured badges, token URL when secured). Card **⋯** menu: copy/open, **Test agent**, **Add to org**, **Security** (visibility + IP), **Unpublish**. **Test agent** autofills sample input; **owners bypass IP/OAuth/private** for testing — non-owners still hit policy. Mock callback inbox: `POST/GET /api/a2a-callback-inbox`. **Admins** see history at **`/admin/a2a-invocations`**.

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
2. Choose **provider** (platform default, Ollama/DeepSeek free, or OpenAI/OpenRouter via **API Keys** → `Platform_BYOK`). Non-platform Profiles auto-seed recommended vault slots as unset.
3. For OpenAI/OpenRouter (and optionally Ollama), also choose a **chat model** from the curated list (or a custom model id). Saving Profile syncs provider + model into OpenClaw for your tenant agents. Catalog: `GET /api/auth/llm-catalog`.
4. Optional **per-tool model**: **Tools** → **Tools → Model** overrides Profile (or platform) model for specific BYOK-aware tools only (keys still from Profile/vault). Help: `knowledgebase/platform-help/11-content-tools-scripts-profile.md`.
5. Browse uploads and generated media under **Content Explorer** (`/content-explorer`).
6. Optional: avatar → **Company setup** (`/company-setup`) for the structured company wizard (help **29**), and/or **Onboarding** / **Onboarding Helper** for freeform dept/agent proposals (help **27**).
7. Optional: **Management → Scheduled goals** or COO chat for lasting daily/weekly prompts (help **28**).
8. Optional (content creator): **Connectors → MCPs** for Facebook Page OAuth (help **31** setup; optional CEO App ID/secret override); publish / community / weekly ops rollup (help **30**). Ops rollup uses the **bell** (`notify_ceo`), not email.
9. Keep MFA settings as required by your organization.
10. Set **Data persistence** (30 / 60 / 90 / 120 / 365 days). A nightly job permanently deletes your chats, chat history, standup conversations and workflow runs older than that; **Purge aged data now** does it immediately. Watch the effect on **Efficiency View → Org → Storage (MB)**.

---

## What’s new (recent product highlights)

> **Milestone (pre–local desktop workflow):** commit [`487f236`](https://github.com/balaji-ranga/agent-os/commit/487f236) — platform API logging (`PLATFORM_LOG_LEVEL=off|error|info`) + secret redaction. Use this as the baseline **before** local-desktop workflow changes.

| Area | What you get in the UI |
|------|-------------------------|
| **Kanban orphan watcher + All view** | Specialty cards stuck `in_progress` (agent run left in `processing` after a restart/hang) are re-pended and reinitiated automatically every 5 minutes (`KANBAN_ORPHAN_WATCHER_CRON`), also from the delegation cron and status checker. Kanban defaults to **All** (any age); Daily/Weekly/Monthly are filters. **status_checker** always counts All — deleting only the Weekly slice leaves older awaiting/failed cards in the report. Deleting a card cancels its pending agent run. |
| **Kanban timezone + archived-chat activity** | Every Kanban date (board tooltips, card **Created**/**Updated**, task chat) renders in the platform timezone (`PLATFORM_TIMEZONE`, else `TZ`) with the zone shown in the board header — no raw UTC. A card's **Activity** tab now also pulls the linked agent-chat turns, so work done in a chat that was later **archived** still shows (tagged `archived`); cards with genuinely no activity say so instead of rendering blank, and a failed detail load shows an error + **Retry**. |
| **COO status checker** | Dashboard → **Run status checker** (COO-entitled `status_checker` tool) opens an HTML CEO report: needs-attention, awaiting-you, **all failed Kanban cards of any age** with failure reason / A2A task + workflow run ids, and recent completions. Also runs daily (`COO_STATUS_CHECKER_CRON`, default 09:00) → standup chat post + HTML email. |
| **Data retention** | Profile → **Data persistence** (30/60/90/120/365 days, default 90). Nightly purge permanently deletes aged chat turns, standup **messages**, workflow runs/steps, and aged **Content Explorer** uploaded/generated media (hard delete). Kanban, Master Data and API keys untouched; manual Content Explorer delete available. |
| **Storage (MB)** | Efficiency View → **Org** tab shows estimated storage for your tenant (chats, standups, workflow runs, Master Data files, **OpenSearch RAG indices**, OpenClaw workspace). Click **i** for breakdown. |
| **Admin → Crons** | `/admin/crons` lists every platform cron (standup dispatcher, legacy standup, delegation queue, job pipeline, COO status checker, data retention, workflow scheduler) with **Pause** / **Resume** / **Run now**. Pause state persists across restarts. |
| **Platform API logging** | `PLATFORM_LOG_LEVEL=off\|error\|info` controls backend access/error logs. Keys, tokens, `Authorization` headers, passwords and MFA codes are redacted, and sensitive paths (API Keys, auth) log method + route only. |
| **Company setup** | Profile → **Company setup** (`/company-setup`): first-run (or re-run) funnel for company type, mission, DNA, team blueprint Apply, systems, management style. Gate may redirect new CEOs until complete/skip. Help: platform-help **29**. Distinct from Onboarding Helper (**27**). |
| **Update Company Details** | Profile avatar → **Update Company Details** (`/update-company-details`): edit mission/DNA/name/industry into Knowledge `company_memory` (creates table if needed). Help **35**. |
| **Scheduled goals** | Management → **Scheduled goals** (`/scheduled-goals`): recurring CEO prompts (**hourly** / daily / weekdays / weekly; perpetual or end date). Create/**edit**/list/pause/run-now in the UI or via COO tools (`scheduled_goal_*`). Only **active** rows fire; pause/delete survives restarts. Hourly uses `time_local` minutes (`:MM`). Platform master tick `SCHEDULED_GOALS_CRON`. **Ops Reporter** weekly rollup goals use **`notify_ceo` → bell** (not email). Help: platform-help **28**, content pack **30**. |
| **Content creator ops** | Company Operate + `content_creator` pack: production loop, **Facebook Page** publish via platform MCP **`mcp-meta-graph`** (Connectors → MCPs OAuth; Page posts only; optional CEO App ID override), OpenConnector for other SaaS, **content-comments-ingest** + community triage, Channel Publisher **`agent_workflow_trigger`** → `content-publish-social`. Help: **30** (ops) + **31** (MCP OAuth setup). Operators: `ensure-platform-mcps.sh`, optional `SEED_CONTENT_MEDIA_OWNER`. |
| **MCP OAuth connectors** | **Connectors → MCPs**: platform (or CEO-override) OAuth **app** credentials in `mcp_oauth_configs` (`owner_user_id` empty = platform; CEO id = override). Secrets encrypted with `USER_API_KEYS_KEK`. Per-CEO access tokens after **Connect**. Facebook: **`mcp-meta-graph`**. Help: **31**. OpenConnector tab configs → **16** + `OPENCONNECTOR-WEBHOOKS.md`. |
| **Scheduled jobs reference** | All platform crons and user-level schedules documented in `knowledgebase/platform-help/19-scheduled-jobs-and-crons.md` (+ **28** for CEO scheduled goals); commented defaults kept in `.env` by `deploy/scripts/ensure-cron-env.sh`. |
| **API Keys vault** | Settings → API Keys — named secrets, optional encryption. Non-platform Profiles auto-seed unset slots (`Platform_BYOK`, `Replicate_BYOK`, `BRAVE_SEARCH_BYOK`, `elevenlabs-key`); OpenAI/OpenRouter need a filled `Platform_BYOK` plus a **chat model** on Profile. Optional **Tools → Model** overrides model per content tool without changing vault keys. |
| **List API pagination** | Large CEO lists use server paging (`limit`/`offset`, envelope `total` + `has_more`): Content Explorer, inbound attachments, workflow definitions + run steps, Kanban/standup threads, agent chat turns/archives, Master Data documents, AgentExchange, admin users, job spreadsheet/review-queue. Helpers: `backend/src/lib/pagination.js`. |
| **Content Explorer** | Management → Content Explorer — browse/preview/download your uploaded + generated files (`inbound/attachments/`, tool media). Server-paged (`limit`/`offset`); UI Prev/Next. See platform-help **26**. |
| **Onboarding Helper** | Avatar → **Onboarding** + Dashboard **Onboarding Helper** chat. Agent saves proposals via `onboarding_save_proposal`; Review checkboxes; Apply creates selected depts/agents. Prompt recipes + E2E script: platform-help **27**, `backend/scripts/e2e-onboarding-wf-prompts.mjs`. |
| **IP Whitelists / package tokens** | **Settings → IP Whitelists** (IBKR bridge, Workflow desktop, A2A, Browser Session worker — help **33**) and **Settings → Tokens management** (list/revoke dsk_ / IBKR / bwk_ — help **34**). |
| **Connectors** | **OpenConnector** + **MCPs** (help **16**/**31**). Downloads: **Browser Session package** (multi-user local worker, help **22**, BROWSER-SESSION-DESKTOP-LOCAL.md) and **Local IBKR bridge** (help **20**). |
| **Efficiency View** | **Org** tab: agents, automated tasks, feedback, workflow run success/fail, Storage (MB) (7d–All). **Department** tab: month-to-date tokens vs each department's budget. **Agent View** tab: per-agent activity, outcomes, token/error budget gauges, **Reset usage** / **Reset all usage** to zero month-to-date tokens without changing budgets. |
| **Agent budgets** | Monthly **token budget** + **error budget %** per agent (and per department, as a planning figure). Warn at 80% via bell, **block** new chat/delegated work at 100% tokens or at the error budget (min 10 terminal calls). Refused calls never spend the error budget. Backed by a durable `token_usage` ledger. |
| **External/A2A agents in your org** | **Add to org** on External Agents / AgentExchange places them as **leaf members** (department + reports-to an internal agent). They show in the org chart, sync into ORG.md / COO AGENTS.md, and the **COO can delegate to them** with Kanban mirroring and budget guard. **Private** A2A listings stay off public endpoints — only COO or the reports-to lead can invoke. Leaves registered as an **External Agent pointing back at your own publication** (`…/api/a2a/<publishId>`) are invoked in-process, so Private / `deny_all` publications no longer fail delegation with `A2A HTTP 403`. |
| **Workspace templates** | Apply / publish SOUL–OPS templates from Agent Workspace (ORG/POLICY preserved). |
| **Platform Help agent** | Dedicated `platformhelp` agent + Master Data help corpus (`knowledgebase/platform-help/`) via keyword RAG. |
| **COO specialty routing** | COO chat routes specialty asks using agent purposes (org docs), not guesswork keywords (multi-intent up to 2). Over-budget internal agents are refused with **Blocked by budget** before any Kanban card or cron job is created. |
| **COO AGENTS.md keeps your edits** | **Resync ORG.md & AGENTS.md** refreshes only the org-generated roster sections of the COO's `AGENTS.md`; your manual Role / Priorities / Tools / Guardrails / custom sections are merged back, and workspace template sync no longer clobbers the generated file. |
| **Get work from team** | The Dashboard standup button fans status requests out to every agent under the COO (budget-aware), instead of classifying the button label as a specialty ask. |
| **Broadcast + notify** | Broadcast can ask agents to report back and ping your bell; quieter when you only want a rollup. |
| **Master Data + document search** | Tables with purposes; documents agents can search; starter **departments** + User Guide + Platform Help docs on register. |
| **Chat tool icons** | See which tools an agent used under a reply (Agent OS content tools + native OpenClaw `browser` / `image` / `cron` from session logs). |
| **Notification tooltips** | Hover the bell snippet for the full message. |
| **Tenant Workspace docs** | Your CEO workspace files stay in your space; Resync keeps ORG/AGENTS accurate. |
| **Shared notification dismiss** | Clear/dismiss keeps the bell feed tidy across platform + agent items. |
| **Agent channels (Slack / WhatsApp)** | Per-agent **Channels** wizard (BYOK vault + OpenClaw bindings). Outbound media must use `MEDIA:/abs/path` so WhatsApp attaches from disk; inbound WhatsApp media is mirrored to `inbound/attachments/` for chat/STT. WhatsApp **groups are disabled by default** (`groupPolicy: disabled`) so group chats are not ingested even when the linked phone is in them — only DMs per `dmPolicy`/`allowFrom`. See platform-help **24**. |
| **Chat attachments + inline media** | Paperclip on Agent Chat uploads files into Master Data + `inbound/attachments/`. Generated image/audio/video play **inline** in chat (login required). Generated media is **auth-only** by default — not world-public (`MEDIA_PUBLIC_SIGNED=1` opt-in). See platform-help **03**, **11**. |
| **Free speech (Whisper + Piper)** | Chat mic + Speak reply; content tools / workflow nodes `speech_stt` / `speech_tts`. Prefer OGG/Opus (or MP3) for WhatsApp TTS attach. Published Scenes guests use slug-scoped public VR tokens (not the signed openclaw media flag). See **25**. |
| **Platform feedback (Admin)** | COO / Platform Help can file bugs via `platform_feedback_*`. Admins triage at **Platform feedback** (`/admin/platform-feedback`): open → implemented / rejected. |

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
- Optional: **cron schedules** — every job has a code default, so nothing is required. Commented reference block lives in `backend/.env.example` / `deploy/.env.example` (and is appended to `deploy/.env` by `deploy/scripts/ensure-cron-env.sh`): `STANDUP_SCHEDULE_CRON`, `STANDUP_CRON_SCHEDULE`, `DELEGATION_CRON_SCHEDULE`, `AGENT_WORKFLOW_SCHEDULER_CRON`, `JOB_PIPELINE_CRON_SCHEDULE`, `COO_STATUS_CHECKER_CRON`, `DATA_RETENTION_CRON`, `KANBAN_ORPHAN_WATCHER_CRON`, `SCHEDULED_GOALS_CRON`. See [Schedulers and crons](#multi-tenancy--schedulers-platform-crons-vs-user-schedules).
- Optional: **AGENT_OS_BASE_URL**, **AGENT_OS_PUBLIC_URL**, or **PUBLIC_URL** — public DNS/HTTPS base URL for workflow event hooks, cron webhooks, A2A cards, and artifact links. Defaults to `http://127.0.0.1:3001` for local dev.
- Optional: **AGENT_OS_DATA_DIR** — directory for SQLite DB (default: `backend/data`).
- Optional: **PLATFORM_LOG_LEVEL** — `off` (silent), `error` (failures only), or `info` (default; one line per API call). Secrets are redacted at every level.
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

Open **http://127.0.0.1:3000/login**. Default admin is seeded from `.env` (`AGENT_OS_ADMIN_*`). CEO users see home chat, **My Org**, Workflows, Kanban, Job profiles, AgentExchange, etc. Admin users manage platform accounts and MCP registry. New CEOs register at `/register` and get provisioned OpenClaw agents, org context, starter **departments**, and this README as a Master Data document.

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
| **Auth & roles** | Login/register; **admin** (user management, MCP registry, platform crons, A2A logs) and **ceo** (agents, workflows, kanban, job pipeline). JWT sessions. New CEO registration provisions OpenClaw agents, syncs org context, seeds **departments** + default **User Guide** document. |
| **Admin platform crons** | `/admin/crons` — registry of every platform timer with **Pause** / **Resume** / **Run now**; pause state is persisted so a paused job stays paused after a restart. |
| **Platform logging & redaction** | `PLATFORM_LOG_LEVEL=off\|error\|info` for backend request/error logs. Secrets (API keys, bearer tokens, `Authorization`, passwords, MFA codes) are redacted from URLs, JSON bodies and headers; API Keys / auth routes log method + route only. Unit tests: `backend/scripts/test-security-hardening-unit.js`. |
| **Multi-tenant isolation** | Standups and delegation tasks carry `owner_user_id`. Standup cron and delegation cron loop **per enabled CEO** so one CEO never sees another’s standups, chats, or queued agent work. APIs filter by authenticated CEO. |
| **Org-aware agents** | Every agent in a CEO’s org gets **ORG.md** (CEO, departments, peers with soul/purpose/skills) plus a tenant-specific COO **AGENTS.md** (delegatees). Synced on provision, agent create, and backend startup. Bootstrap watcher reloads `ORG.md` each turn. |
| **Home chat** | `/` — COO chat by default; agent picker; history/browser panes; **OEI** KPI + explain popover (help **36**). |
| **My Org** | `/org` — Org chart; standups with COO chat (owner-scoped only); **Resync ORG.md & AGENTS.md**. Profile **Your title** is display-only. Add agents from **Agent Workspaces**. |
| **Chat** | 1:1 chat with an OpenClaw agent via gateway; session affinity per agent; history stored in SQLite; **tool-call icons** on assistant replies when Agent OS tools ran. |
| **Agent Workspaces** | List agents; **Add agent**; per-agent **SOUL.md, AGENTS.md, ORG.md, MEMORY.md, TOOLS.md** editor; **Tools access** panel (grant/revoke content tools per agent, hot-sync to OpenClaw without gateway restart). |
| **Notifications** | **Bell icon** in nav: agent responses + platform notifications; hover for full text; link to agent Chat; clear/dismiss (shared feed). |
| **Kanban** | Board view (tasks by agent and status); task detail with **task chat**, artifacts, workflow run links, and linked agent-chat turns (including chats archived later). Reopen task; create task (COO or direct to agent). Auto-completes when COO chat delegations finish. All dates in the platform timezone. |
| **Custom workflows** | Visual **Workflows** editor: trigger (manual / schedule / chat / event webhook), agent, API, MCP tool, **SSE listen**, **sub-workflow**, Brain (LLM + optional MCP tool calling; **Thinking mode** for DeepSeek/OpenRouter), email, IF/While, parallel/merge, CEO approval, **external agent (A2A)**. Publish, run instances, paginated run history, search, **stop SSE listen** on active runs. |
| **Download for Windows** | From a **published** workflow: download a PS1 + params package (optional portable Node 18). Local graph orchestration + localhost API / filesystem; run state and other nodes on Flolah. Desktop token + optional IP whitelist. See `knowledgebase/platform-help/17-desktop-windows-download.md`. |
| **Publish as A2A** | **Publish A2A** exposes a workflow as an A2A agent (agent card + JSON-RPC). **Visibility** Public (default) or **Private** (org-only). **Sync** or **Async** invoke; optional **callback URL**. **Deny all** IP access by default; **Allow all** or **IP whitelist**. **Public auth** or **Secured** (OAuth). **Publish as new agent** or update by `publish_id`. |
| **AgentExchange** | Browse published A2A workflow agents (`/agent-exchange`). Card **⋯** menu for copy/open, **Security**, **Test agent**, **Add to org**, **Unpublish**. Private listings are hidden from other CEOs. Admin **A2A logs** (`/admin/a2a-invocations`). |
| **Workflow Builder chat** | LLM assistant in the workflow editor to create/edit graphs via natural language. |
| **Job profiles** | CEO job search profiles (intake, resume, preferences); gate for Job Applicant pipeline. |
| **Job workflows** | Multi-agent **Job Applicant** pipeline (Discovery → Fit Scoring → Resume Tailoring → Application); Kanban-tracked stages; browser/Playwright apply path. See **knowledgebase/JOB-APPLICANT-WORKFLOW.md**. |
| **MCP integrations** | Register MCP servers (admin/CEO); connect, test tools, playground; use in workflow **MCP Tool** and **SSE Listen** nodes. Local test server: `tools/local-mcp-random-sse/`. Bundled **Brave Search MCP** (`optional-brave-mcp`, header BYOK). **Meta Graph MCP** (`optional-meta-graph-mcp`, Connectors OAuth — help **31**). **Business Core MCP** (`optional-business-core-mcp`) seeds **`mcp-flolah-crm`** + **`mcp-flolah-erp`** (Twenty/ERPNext tools; help **32**). Agent content tool **`brave_web_search`** uses platform `BRAVE_API_KEY` or vault **`BRAVE_SEARCH_BYOK`**. Deploy: `deploy/scripts/ensure-platform-mcps.sh`. |
| **Digest (This Week)** | Top-nav `/this-week`: Time Saved, Est. Value Delivered (sum of completed work x each AI employee `hourly_rate_usd`, hire default $10/hr), insights. Env: `THIS_WEEK_MINUTES_PER_TASK`, fallback `THIS_WEEK_VALUE_USD_PER_HOUR`. COO tool `this_week_digest`. Platform Help **02**. |
| **Operational effectiveness (OEI)** | Home score **0–100** (Green≥**75**, Amber 50–74, Red 0–49) over **14 days**, equal-weight domains (vision, org, goals, workflows, autonomy, CRM platform-or-MCA, governance). Rules-only. **Goal runs (14d)** = firings from `scheduled_goal_runs` (not distinct-goals-only). `GET /api/operational-effectiveness` + COO tool `operational_effectiveness`. Help **36**. Not Digest dollars. |
| **Workspace Builder** | `/workspace-designer` designs owner boards for /work (not Digest). REST/MD/RAG bindings, default publish. |
| **Business Core (CRM/ERP)** | Optional **Twenty** or **ERPNext** CRM / **ERPNext** ERP on Profile or Company setup. CRM=Twenty → Twenty SSO embed + prefab Makers/Checker (`crm_*`). CRM=ERPNext → ERPNext Sales/CRM desk SSO + prefab Makers/Checker (`erp_*` sales tools). ERP=ERPNext → ERP Maker A/B (full `erp_*` = MCP surface), Checker (submit/cancel + workflow/task approvals), plus P&L/Invoice/Project specialists. Content tools parity with MCP; platform **mcp-flolah-crm** / **mcp-flolah-erp**. Plan: `knowledgebase/BUSINESS-CORE-WORKSPACE-PLAN.md`. Daily **Work**: `/work`. ERP Docker: MariaDB (`optional-erpnext`); isolation 1 CEO → 1 Company. |
| **Automated company P&L (design)** | Planned run-cost + income pipelines (usage meters, CRM/channel/IBKR income events, period ERP postings, operating vs trading success). Design: [`knowledgebase/AUTOMATED-PNL.md`](knowledgebase/AUTOMATED-PNL.md). CEO pointer: platform-help **37**. |
| **External agents (A2A)** | Register external agent endpoints; invoke from workflow **External Agent** node. |
| **Tools** (UI `/content-tools`) | Agent-callable **content tools**: summarize URL, image/video gen, Kanban, **intent_classify_and_delegate**, workflow trigger/enquire/mutate, job applicant tools, **email_send**, **notify_ceo**, **Master Data**, learnings, etc.; owner-scoped logs UI; **Tools → Model** (per-CEO tool→model overrides for BYOK-aware tools; excludes custom-script review and embeddings); onboard new APIs via script. |
| **Browser Session** | `/browser-session` — managed Playwright, **Client Chrome** (Browser Relay, exclusive lease), or **Desktop Local worker** (Connectors package: headed Playwright + persistent browser-profile; multi-CEO). Agents use **`browse_*`** tools; grant list vs run in Workspace → Tool access. CDP `browser-cdp` when worker offline. Guides: CLIENT-BROWSER-SESSION.md, BROWSER-SESSION-DESKTOP-LOCAL.md, platform-help **22**. |
| **Master Data & RAG** | Per-CEO tables + documents (OpenSearch BM25 + **local Qwen** k-NN embeddings via Compose `optional-embeddings`; no OpenAI embedding API). UI captures **purpose/description** per table. Agents list tables with purpose and CRUD rows / RAG docs via content tools — **no create/alter/drop table**. On register: starter **departments** table + **Flolah User Guide** + **Platform Help** document set. **Inbound attachments** + **Content Explorer** for chat/channel files. **Purge all uploads** removes CEO uploads only; help/guide docs are protected. |
| **Profile LLM catalog** | Provider + model picker on **Register** and **Profile** (`llm_provider` / `llm_model`); `GET /api/auth/llm-catalog`; OpenClaw sync on Profile save. BYOK keys only via API Keys vault after login. |
| **Platform Help** | Standard agent `platformhelp` — product how-to via `master_data_rag` over `knowledgebase/platform-help/`. See [`knowledgebase/platform-help/README.md`](knowledgebase/platform-help/README.md). |
| **COO specialty delegation** | COO chat hard-path: AGENTS.md purpose intent → specialist(s) (cap 2 for multi-intent) + Kanban; peer specialty referral; COO-native work stays with COO; how-to → Platform Help; graph build → Workflow Builder. |
| **Email send** | `email_send` content tool — agents can send email via configured mail integration (owner-scoped logging). |
| **Notify CEO** | `notify_ceo` content tool — agents push a platform notification to their CEO (bell feed). **Not email** (ops rollups and community escalations use this by default). |
| **Broadcast** | Send messages to multiple agents; LLM intent for status+notify; paced fan-out; exclude COO by default. |
| **Tools onboarding** | Script `scripts/onboard-api-tool.js` onboards a new API as a tool from JSON (updates DB, OpenClaw tool list). See `scripts/tool-definitions/README.md`. |
| **Workspace (legacy MD)** | Global workspace MD editor (older path); prefer **Agent workspace** per agent. |
| **DB** | SQLite: agents, users, chat, standups (`owner_user_id`), delegations (`owner_user_id`), kanban, content tools, job profiles/applications, MCP servers, agent workflow definitions/runs, A2A publications, external agents, platform notifications, audit. |
| **Agent memory** | Backend injects each agent’s MEMORY.md into delegation prompts and appends summaries on task completion (tenant workspace path). |

### Multi-tenancy & schedulers (platform crons vs user schedules)

**One timer per job per backend process (platform level); each tick loops enabled CEOs and applies that CEO’s own settings (user level).** There is no OS cron entry per CEO. All keys optional — defaults shown.

| Env var (platform timer) | Default | Behavior | Per-user input |
|--------------------------|---------|----------|----------------|
| `STANDUP_SCHEDULE_CRON` | `* * * * *` | Dispatcher for user-created standups | standup `scheduled_at` (daily, once/day, owner enabled) |
| `STANDUP_CRON_SCHEDULE` | *(empty = off)* | Legacy auto-collect standup per enabled CEO (`owner_user_id` + owner-tagged prompts) | — |
| `DELEGATION_CRON_SCHEDULE` | `* * * * *` | Claims only that CEO’s `pending` `agent_delegation_tasks`, runs agents in that CEO’s OpenClaw tenant, posts callbacks only for that CEO’s request IDs | queued COO→agent tasks |
| `AGENT_WORKFLOW_SCHEDULER_CRON` | `* * * * *` | Master tick for custom agent workflows | definition `schedule_cron` + `schedule` trigger mode |
| `JOB_PIPELINE_CRON_SCHEDULE` | `0 * * * *` | Job Applicant pipeline tick across active profiles | profile `workflow_schedule` (hourly/daily/weekly) |
| `COO_STATUS_CHECKER_CRON` | `0 9 * * *` | COO status digest per enabled CEO → standup post + HTML email | CEO email, own Kanban/A2A state |
| `SCHEDULED_GOALS_CRON` | `* * * * *` | Fire **active** scheduled goals (CEO prompts) to target AI employees | goal `time_local` / cadence (hourly\|daily\|weekdays\|weekly) / ends_at; pause/delete = off across restarts |
| `DATA_RETENTION_CRON` | `15 3 * * *` | Retention purge per enabled CEO (chat turns, standup messages, workflow runs/steps) | Profile `data_retention_days` (30/60/90/120/365, default 90) |

Cron expressions use the container clock (`TZ`). Dates **shown to users** (Kanban, task chat, reports) use `PLATFORM_TIMEZONE` when set, otherwise `TZ` — so the UI never renders raw UTC.

Not crons: workflow **timeout watchdog** (30s `setInterval`, reaps timed-out steps after restarts) and **one-shot OpenClaw Gateway cron jobs** created per delegated task (fire once, then gone).

Manual triggers: `POST /api/cron/run-standup`, `/cron/process-delegations`, `/cron/run-status-checker`, `/cron/run-data-retention`; UI buttons **Run COO**, **Run status checker**, **Purge data older than N days**, **Scheduled goals → Run now**. Crons guide: `knowledgebase/platform-help/19-scheduled-jobs-and-crons.md`. CEO scheduled goals: `knowledgebase/platform-help/28-scheduled-goals.md`.

New CEOs start with **empty** standups (no other user’s chats or agents), starter Master Data (**departments** + User Guide document). Dashboard does not auto-open another CEO’s standup.

### Custom Agent Workflows (high level)

- **Editor:** `/workflows` → create from template or blank → `/workflows/:id/edit`
- **Triggers:** manual, cron schedule, chat phrase, **event webhook** (hook URL on Start node when event mode enabled; uses `AGENT_OS_BASE_URL`)
- **Node types:** Trigger, Agent, Content Tool, MCP Tool, **SSE Listen** (long-running stream; dispatches downstream on each event), **Sub-workflow**, Call API (Basic/Bearer/API-key auth + custom headers), Brain, Email, IF, While, Parallel, Merge, CEO Approval, External Agent
- **Data binding:** `{{nodeId.outputKey}}` and nested paths (e.g. `{{api-1.body.accessToken}}`, `{{trigger-1.trigger_input.query}}`); workflow variables `{{var.key}}` (editor **Workflow variables** panel — shared static config for that definition, not platform-wide globals). Full guide: `knowledgebase/platform-help/14-workflow-dynamic-values.md`.
- **Dynamic auth:** API / MCP / Brain `apiKey` / External Agent override / SSE headers accept the same `{{…}}` templates (values look static in the UI; runner substitutes at execute time). Brave Search MCP is **BYOK** (workflow headers only — no container `BRAVE_API_KEY` fallback). Agent tool `brave_web_search` uses platform `BRAVE_API_KEY` or vault `BRAVE_SEARCH_BYOK` by Profile.
- **A2A publish:** Publish → AgentExchange + agent card / JSON-RPC under `/api/a2a/:publishId`. **Visibility** `public` (default) or `private` (public endpoints always denied; COO / reports-to lead via org path only). **Sync** or **Async**; optional callback URL. **Deny all** IP default; **Allow all** or IP whitelist. **Public auth** or **Secured** OAuth.
- **Download for Windows:** Published workflow → **Download for Windows** (lite or with portable Node 18). Local orchestrator; Flolah holds run state + remote nodes. Guide: `knowledgebase/platform-help/17-desktop-windows-download.md`.
- **IBKR Monthly Positive Return:** Cloud plans (W1/W3/W5) + laptop execute (W2) + local bridge. **IBKR Summary** UI `/ibkr-summary` (owner-scoped portfolio & plan vs done; **Clear data…** wipes transactional rows only). CEO help **20**; ops `knowledgebase/IBKR-MONTHLY-WORKFLOWS.md`; bridge `backend/local-ibkr-bridge/`.
- **Runs:** Kanban tasks per step; fail run on API/MCP errors (non-2xx HTTP, SSL errors, MCP `is_error`)
- **Help:** Platform Help agent RAG over `knowledgebase/platform-help/` (re-upload with `node backend/scripts/reupload-platform-help-docs.js` after doc changes).
- **Tests:** `node backend/scripts/test-sse-workflow.js`, `node backend/scripts/test-balaji-brave-byok-workflow.js`, `node backend/scripts/test-workflow-auth-templates.js`, `node backend/scripts/test-workflow-desktop-package.js`

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

Hosts (production):

| Host | Content |
|------|---------|
| `https://flolah.cloud` | Marketing homepage (`deploy/static/flolah-home`) |
| `https://login.flolah.cloud` | Login + React SPA + API (`AGENT_OS_PUBLIC_URL`) |

```bash
cd deploy
cp .env.example .env   # set AGENT_OS_PUBLIC_URL=https://login.flolah.cloud, tokens, OPENAI_API_KEY
./scripts/up.sh        # auto-fills TOOLS_API_KEY + AGENT_OS_INTERNAL_TOKEN; USE_PODMAN=1 on CentOS
```

Laptop sync (when VPS cannot `git pull`):

```powershell
.\deploy\scripts\sync-to-vps.ps1
.\deploy\scripts\sync-to-vps.ps1 -Services frontend
.\deploy\scripts\sync-to-vps.ps1 -Services "backend openclaw"
.\deploy\scripts\sync-to-vps.ps1 -NoCache   # stale Docker layers
```

Public API / app host = `AGENT_OS_PUBLIC_URL` in `deploy/.env` (`https://login.flolah.cloud`). Marketing apex is separate static content — not a parked domain.

On VPS after sync / `git pull`:

```bash
bash /opt/agent-os/deploy/scripts/vps-deploy-latest.sh
# First time after DNS A for login points to VPS (uses acme.sh TLS-ALPN on :443; not certbot HTTP-01):
bash /opt/agent-os/deploy/scripts/vps-expand-login-cert.sh
SERVICES=frontend bash /opt/agent-os/deploy/scripts/vps-rebuild-frontend.sh
bash /opt/agent-os/deploy/scripts/vps-verify-frontend-media.sh   # hPanel + fullscreen + CTAs
bash /opt/agent-os/deploy/scripts/vps-verify-platform.sh         # Platform Help + Master Data + marketing hosts
bash /opt/agent-os/deploy/scripts/vps-verify-status-retention-ui.sh  # status checker + retention + Storage UI
```

Onboarding Helper + Workflow Builder **chat E2E** (CEO token; prompts in platform-help **27**):

```powershell
$env:BASE_URL = "https://login.flolah.cloud"
$env:TOKEN = "<ceo-session>"
node backend/scripts/e2e-onboarding-wf-prompts.mjs
```

`vps-deploy-latest.sh` already chains these: `ensure-cron-env.sh` (cron reference block in `deploy/.env`),
the status/retention checks, `reupload-platform-help-docs.js` (help corpus → every CEO's Master Data),
then the smoke suite (`vps-smoke-new-features.sh`, `vps-smoke-budgets-org-members.sh`,
`vps-smoke-brave-byok.sh` when `BRAVE_API_KEY` is set, `vps-verify-platform.sh`).

- **deploy/README.md** — Compose services, volumes, profiles, UI redeploy markers, OpenConnector / email-inbound, repeatable sync
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

Authenticated list endpoints that can grow unbounded use **server pagination**. Pass `limit` + `offset` (or domain aliases such as `steps_limit` / `messages_limit`). Response envelope:

`{ <domainKey>, total, limit, offset, has_more }`

Examples: `workflows`, `tasks`, `standups`, `documents`, `items`, `users`, `agents`, `turns`/`sessions`, job spreadsheet `rows`. Helpers live in `backend/src/lib/pagination.js`. Default pages are typically 50–100 (max often 200–500). Kanban board UI loads pages until complete; Content Explorer shows Prev/Next.

### Core

- `GET /health` — liveness
- **Auth:** `POST /auth/login`, `POST /auth/register`, `GET /auth/me`, profile update
- **Admin:** `GET /admin/users?limit=&offset=` (paged user list), enable/disable users, grant agents; **`GET /admin/a2a-invocations`** — A2A card/token/invoke audit (denials included)
- **Admin crons:** `GET /admin/crons`, `GET /admin/crons/:id`, `POST /admin/crons/:id/pause`, `.../resume`, `.../run` — platform timer registry, persisted pause state, one-shot run

### Agents & workspace

- `GET/POST /agents` — agent CRUD
- `GET/POST /agents/:id/chat` — chat history and send message (→ gateway); history turns paged (`?limit=&offset=`, default 200)
- `GET /agents/:id/chat/history` — archived sessions (`?limit=&offset=&days=`)
- `GET/PUT /agents/:id/workspace/:file` — soul, agents, **org**, memory, tools MD
- `GET/PUT /agents/:id/tools` — per-agent content tool grants

### Standups, Kanban, cron

- `GET/POST/PATCH/DELETE /standups`, `/standups/:id/messages`, `/standups/:id/run-coo` — **owner-scoped**; list and messages are paged (`standups` array + total/has_more)
- `GET /standups/notifications` — bell feed (delegation responses for this CEO)
- `GET/PATCH /kanban/tasks` — paged (`tasks`, `total`, `has_more`; offset; higher max for All view), task messages, reopen, artifacts
- `POST /cron/run-standup`, `POST /cron/process-delegations` — standup per CEO; delegations per CEO
- `POST /cron/run-status-checker` — COO status report now (CEO session = own tenant, returns `html` + `digest` for the Dashboard popup; admin/internal = all CEOs)
- `POST /cron/run-data-retention` — retention purge now (CEO session = own data; admin/internal = all CEOs)
- `GET /platform-notifications` — CEO notify feed (`notify_ceo`)

### Tools (content tools API)

- UI: **Tools** nav → `/content-tools` (catalog, test, logs, **Tools → Model**).
- `GET /tools/meta`, `POST /tools/invoke`, workflow chat tools (`agent_workflow_*`), job applicant tools
- `GET/PUT /tools/model-mappings` — CEO-scoped tool→model overrides (BYOK-aware tools; owner keys unchanged)
- `POST /tools/intent-classify-and-delegate` — COO delegation (stamps `owner_user_id` on standup/tasks)
- `POST /tools/...` — `email_send`, `notify_ceo`, Kanban helpers, etc. (owner resolved from auth / tenant, not spoofable body ids)

### Job applicant

- `/job-applicant/*` — profiles, applications, pipeline runs, browser auth, CEO review. Spreadsheet `GET …/spreadsheet?limit=&offset=`; review-queue per-bucket cap via `?limit=`. See **knowledgebase/JOB-APPLICANT-WORKFLOW.md**.

### Custom agent workflows

- `GET/POST/PATCH/DELETE /agent-workflows` — definitions list is paged and omits graph JSON (`?q=&limit=&offset=`); full graph on `GET :id`. Publish, audit
- `POST /agent-workflows/:id/run` — start run
- `GET /agent-workflows/runs` — paginated runs (`?page=&limit=&q=`)
- `GET /agent-workflows/runs/:runId?steps_limit=&steps_offset=` — run detail with paged steps
- `POST /agent-workflows/runs/:runId/listen/:nodeId/stop` — stop SSE listen
- `POST /agent-workflows/hooks/:definitionId` — event trigger (webhook secret header)
- `POST /agent-workflows/agent-chat` — Workflow Builder LLM
- `POST /agent-workflows/approval/respond` — CEO approval from Kanban
- **A2A publish:** `POST /agent-workflows/:id/publish-a2a` with `auth_mode: public|secured` (optional `rotate_credentials`); `DELETE .../a2a-publication` to unpublish
- **Desktop Windows package (CEO session):** `GET /agent-workflows/:id/desktop-package?include_runtime=0|1` — zip (mints token); `GET/DELETE .../desktop-tokens`; `GET/POST/DELETE .../desktop-ip-whitelist` (writes central `owner_ip_whitelists`)
- **Central IP whitelists (CEO session):** `GET/POST /settings/ip-whitelists`, `PUT/DELETE /settings/ip-whitelists/:entryId` — apply flags: `apply_ibkr_bridge`, `apply_workflow_desktop`, `apply_a2a`, `apply_browser_worker` (+ optional `definition_id` / `publish_id` scope). Same store as federated desktop / A2A / browser worker UIs. Help **33**.
- **External package tokens (CEO session):** `GET /settings/external-tokens`, `DELETE /settings/external-tokens/:kind/:id`. Help **34**.
- **Company memory capture (CEO session):** `GET/PUT /company-setup/company-memory` — Update Company Details UI. Help **35**.
- **Browser Session desktop worker:** `GET /integrations/browser-worker/package` + status/tokens; worker API `/api/browser-worker/v1/*`.
- **Desktop client API (Bearer `dsk_…` + optional IP whitelist):** `/agent-workflows/desktop/v1/runs`, `.../steps`, `.../execute-node`, `.../complete`

### AgentExchange & A2A

- `GET /agent-exchange?limit=&offset=` — list published A2A workflow agents (CEO/Admin); owner `can_manage` for Security / Unpublish
- `GET /agent-exchange/:publishId/test-sample` — sample input from agent card `inputSchema` (Test UI autofill)
- `POST /agent-exchange/:publishId/test` — authenticated test invoke (owners bypass IP deny/whitelist and OAuth; logged as `source=agent_exchange_test`)
- `GET /admin/a2a-invocations` — admin report of all A2A attempts (`denied` / `error` / `success` / `failed`), including blocks before a workflow run starts
- `GET/PUT /agent-exchange/:publishId/access` — access policy (`deny_all` | `allow_all` | `whitelist`); body may also set `visibility`
- `PUT /agent-exchange/:publishId/visibility` — `public` (default) | `private` (disables public calling; org COO / reports-to lead only)
- `POST/DELETE /agent-exchange/:publishId/ip-whitelist` — whitelist entries (IPv4 CIDR ok; IPv6 exact only)
- `DELETE /agent-exchange/:publishId` — unpublish A2A listing (workflow remains published)
- `GET /a2a/:publishId/.well-known/agent-card.json` — agent card (403 when visibility=private or IP denied)
- `POST /a2a/:publishId/oauth/token` — `grant_type=client_credentials` + `client_id` / `client_secret` → Bearer access token
- `POST /a2a/:publishId` — A2A JSON-RPC invoke (blocked when `visibility=private`, `deny_all`, or IP not whitelisted; no auth when public auth + allowed; Bearer when secured). Async enquire / `tasks/get`: final step text in **`result.parts[0].text`**; state in **`result.task.status.state`**; run meta in **`result.metadata.run`**. Callback webhook: same text in **`final_output`**.
- `POST/GET /a2a-callback-inbox` — mock async callback receiver (GET requires CEO auth; sample webhook JSON in response)
- **Publish body:** `visibility: public|private`, `invoke_mode: sync|async`, `callback_url`, `as_new_agent`, `publish_id` (update), `auth_mode: public|secured`
- Optional env: `A2A_ACCESS_TOKEN_TTL_SEC` (default `3600`), `A2A_SYNC_TIMEOUT_MS`, `A2A_ASYNC_WATCH_TIMEOUT_MS`, `A2A_CALLBACK_TIMEOUT_MS`

### MCP & external agents

- `/integrations/mcp/*` — MCP server registry, connect, test, call tool
- `/external-agents/*` — A2A agent registry and task invoke

### Org members (external / A2A leaf agents)

- `GET /org-members` — leaf members in the CEO's org chart
- `POST /org-members` — add/update a leaf member (`kind: external|a2a_publish`, `ref_id`, `display_name`, `purpose`, `department`, `parent_id` internal agent, `monthly_token_budget`, `error_budget_pct`)
- `DELETE /org-members/:id` — remove from the org chart (registry entry untouched)

### Efficiency & budgets

- `GET /efficiency/summary?days=7|14|30|90|all` — Org tab metrics + timeline
- `GET /efficiency/departments` — month-to-date tokens vs `monthly_token_budget` per department (Department tab)
- `GET /efficiency/agents` — selectable members (internal + leaf) with current-month budget state
- `GET /efficiency/agents/:memberKey?days=30` — Agent View metrics (activity, outcomes, tokens, reliability, top tools)
- `PUT /efficiency/agents/:memberKey/budget` — set `monthly_token_budget` / `error_budget_pct`
- `POST /efficiency/usage/reset` — zero month-to-date `token_usage` for one `member_key` (omit for all); budgets unchanged
- `GET /efficiency/storage` — tenant storage estimate (`storage_mb`, `components[]` incl. OpenSearch RAG); also folded into `GET /efficiency/summary` totals (`storage_mb`, `storage_breakdown`) for the Org **Storage (MB)** tile (click **i** for popup)
- `GET/PUT /efficiency/retention` — read / set `data_retention_days` (30, 60, 90, 120, 365)
- `POST /efficiency/retention/purge` — purge this CEO's aged chats, chat history, standup conversations and workflow runs now
- Ledger `token_usage` sources: `openclaw_chat`, `delegation`, `workflow_brain`, `a2a_outbound`; provider usage when returned, otherwise a flagged `chars/4` estimate

### Master Data

- `/master-data/*` — tables, rows, documents, RAG (per CEO). Default User Guide document + departments seeded on CEO register / backend startup backfill.
- `departments` table carries `name`, `purpose`, `monthly_token_budget`; purpose is synced into agent workspaces via ORG.md.
- `POST /master-data/documents/purge-all` — delete all **user-uploaded** documents (DB + disk); Platform Help / User Guide retained.
- `DELETE /master-data/documents/:id` — blocked with `403` / `PROTECTED_DOCUMENT` for help/guide docs (`is_protected` on list responses).

### Media

- `GET /api/media/openclaw/*` — OpenClaw-generated media for Dashboard chat / Kanban. **Requires login (Bearer)** by default. Optional anonymous `?exp=&sig=` only when ops sets `MEDIA_PUBLIC_SIGNED=1` (off by default; see `deploy/.env.example`).
- Content tools (`generate_image`, `generate_video`, `speech_tts`, …) return `paste_exactly` / `media_uri` as **`MEDIA:/abs/path`** for **WhatsApp file attach** on the shared OpenClaw volume, plus auth-only `relative_url` (`/api/media/…`) for the web UI.
- Dashboard chat renders `MEDIA:` and `/api/media` as **inline** image / audio / video players (authenticated blob fetch). Do **not** paste bare auth HTTPS media URLs into WhatsApp (shows “Media failed”).
- Guest Published Scenes use separate `/api/public/vr/:slug/artifacts/…?t=…` tokens — unrelated to `MEDIA_PUBLIC_SIGNED`.
- Docs: `knowledgebase/platform-help/11-content-tools-scripts-profile.md`, `24-agent-channels.md`, `25-speech-and-published-scenes.md`.

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
- **Default CEO Master Data:** `backend/src/services/ceo-default-master-data.js` — departments table + Flolah User Guide (README) + Platform Help docs (`knowledgebase/platform-help/`) on register and startup backfill
- **Protected docs:** `backend/src/services/master-data-protected-docs.js` — help/guide titles & filenames cannot be deleted by CEOs (seed refresh uses `{ force: true }`)
- **Agent delete:** `backend/src/services/agent-delete.js` — `deleteAgentCascade()` runs in one transaction and clears every table that references `agents(id)` (kanban cards are **unassigned**, not deleted; children reparent to the deleted agent's parent). Deletes are recorded in `deleted_agents`, so the startup catalog re-grant (`grantStandardAgents`) and `POST /api/openclaw/sync` will not recreate the agent; an explicit create clears the tombstone
- **Backend scripts:** `backend/scripts/` — seeds, E2E tests (`test-purge-all-documents.js`, `test-agent-delete-cascade.js`, learnings/history cache, …), MCP seed, workflow tests, COO org/delegation smoke, `cleanup-workflow-runs.js`
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
├── tools/brave-search-mcp-byok/   # Brave Search REST → HTTP MCP wrapper (BYOK headers only)
├── tools/meta-graph-mcp/          # Facebook/IG Graph → HTTP MCP
├── tools/business-core-mcp/       # Flolah CRM/ERP tools → HTTP MCP (workflows)
├── openclaw-workspace-templates/  # SOUL, AGENTS, MEMORY, TOOLS, ORG per agent type
├── openclaw-skills/            # agent-send, agent-os-content-tools, etc.
├── openclaw-extensions/        # agent-os-content-tools plugin, bootstrap watcher (ORG.md)
├── deploy/                     # Docker Compose, nginx dual-vhost, static/flolah-home marketing,
│                               #   sync-to-vps.ps1, vps-deploy-latest.sh, vps-expand-login-cert.sh
├── backend/
│   ├── .env.example
│   ├── data/                   # SQLite
│   ├── local-browser-worker/   # Windows Browser Session package (Playwright ≥1.55.1 persistent profile)
│   ├── local-ibkr-bridge/      # Windows IBKR bridge package for Connectors
│   ├── desktop-workflow-runner/# Download for Windows runner sources
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
        ├── pages/              # Dashboard, Login (Flolah footer), AgentChat,
        │                         # AgentWorkspace, Kanban, AgentWorkflows,
        │                         # AgentWorkflowEditor, AgentExchange, JobProfiles,
        │                         # JobWorkflows, MasterData, Broadcast, ApiKeys,
        │                         # Connectors, BrowserSession, IpWhitelists, TokensManagement,
        │                         # AiSnipper, EfficiencyView,
        │                         # AdminCrons, AdminA2AInvocations, …
        └── components/         # NotificationBell, PublishA2AModal, ChatComposeInput,
                                # ChatToolCalls, workflow editor nodes, Kanban artifacts
```

## Documentation (knowledge base)

All project docs except this README live in **`knowledgebase/`**:

| File | Purpose |
|------|---------|
| **platform-help/** | CEO Platform Help RAG corpus (incl. **22** Browser Session desktop worker, **33** IP Whitelists, **34** Tokens; **35** Update Company Details) |
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
| **IBKR-TRADING-WORKFLOW.md** | Legacy IBKR maker/checker paper day-plan workflow |
| **IBKR-MONTHLY-WORKFLOWS.md** | Monthly Positive Return **W1–W5** (+ bridge): names, goals, outcomes; Summary UI + clear-transactional APIs |
| **IBKR-MONTHLY-TRADING-PLAN.md** | Monthly system architecture, phases, strategy appendix |
| **IBKR-MONTHLY-EXECUTION-MODEL.md** | Cloud vs laptop execution + laptop↔VPS recovery |
| **IBKR-LOCAL-BRIDGE.md** | Laptop HTTP bridge, Connectors zip, Gateway, webhooks |
| **CLIENT-BROWSER-SESSION.md** / **BROWSER-SESSION-DESKTOP-LOCAL.md** | Client Chrome + multi-user local Browser Session worker |
| **platform-help/22**, **33**, **34**, **35** | Browser Session; IP Whitelists; Tokens; Update Company Details |
| **platform-help/20-ibkr-monthly-trading.md** | **CEO help:** W1–W5 defs, flow diagrams, isolation, **IBKR Summary / Clear data**, bridge setup |
| **IBKR-MONTHLY-PHASE4.md** | Paper E2E + certify runbook before live |
| **knowledgeGraph.md** | Neo4j knowledge graph / self-improvement |

See **knowledgebase/README.md** for the full index.

## License

Same as parent project.
