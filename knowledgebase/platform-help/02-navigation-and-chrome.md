# Navigation and chrome

## Top bar

- **Left nav toggle** — collapse/expand the sidebar (icons only when collapsed).
- **Notification bell** — platform alerts (`notify_ceo`) and agent/standup responses. Each item shows its datetime. Hover a short snippet for the full title/body. Open linked chat or Kanban. Clear/dismiss items you have handled.
- **Profile menu** — Edit profile (`/profile`), **Company setup** (`/company-setup` — first-run company wizard; [29-company-setup.md](./29-company-setup.md)), **Onboarding** (`/onboarding` — freeform org draft/Review/Apply; [27-onboarding-helper.md](./27-onboarding-helper.md)), light/dark theme, Logout.
- **Theme toggle** — sun/moon control in the top bar (also under Profile). Choice is saved in the browser.
- **Impersonation banner** — only when an admin is impersonating a CEO.

## CEO left navigation

### Run & Operate

| Label | Route | Use for |
|-------|-------|---------|
| My Org / Dashboard | `/` or `/org` | Org chart, standups + COO chat, Resync ORG/AGENTS |
| Kanban | `/kanban` | Work tasks (AI employee / workflow / pipeline cards), CEO approvals, artifacts |
| **Scheduled goals** | `/scheduled-goals` | Recurring CEO prompts (**hourly** / daily / weekdays / weekly); create **and edit**; pause survives restarts. Also via COO chat. See [28-scheduled-goals.md](./28-scheduled-goals.md) |
| Broadcast | `/broadcast` | Message many AI employees at once |
| **Knowledge** | `/master-data` | Company knowledge: tables, documents, RAG, **Inbound attachments** (Master Data) |
| **Content Explorer** | `/content-explorer` | Browse uploaded + generated files (preview/download) |
| **API Keys** | `/api-keys` | Named secret vault (auto-seeded BYOK slots + workflow/MCP/Connector secrets) |
| Policies | `/policies` | CEO common guardrails for all AI employees + Brain nodes |
| AI Snipper | `/ai-snipper` | Prompt / token / tool-call usage timeline |
| **Browser Session** | `/browser-session` | Client Chrome relay, NL browser tasks, recorder recipes |
| **Efficiency View** | `/efficiency` | **Org** tab: AI employees, automated tasks, feedback, workflow run success/fail, Storage (MB). **Department** tab: month-to-date tokens vs department budget. **Agent View** tab: per-employee activity, outcomes, token/error budgets, **Reset usage** |
| **Work** | `/work` | Daily operating workspace (tasks + **Recent AI activity** + command bar). Activity highlights significant work: **Kanban completed/failed** (agent-assigned) and **workflow brain runs**, plus optional rated replies — not raw tool call spam. Datetimes use **Profile → Display timezone**. See [32-business-core-crm-erp.md](./32-business-core-crm-erp.md) |
| **CRM** | `/crm` | Shown only when Profile CRM = Twenty (platform embed) |
| **ERP** | `/erp` | Shown only when Profile ERP = ERPNext (platform embed) |
| **3D Avatars** | `/avatars` | Avatar models, Virtual Rooms, publish public scenes |
| **Published Scenes** | `/published-scenes` | Guest Virtual Room links (`/p/vr/:slug`) |

### Prebuilt Workflows

| Label | Route | Use for |
|-------|-------|---------|
| Job profiles | `/job-profiles` | Job-search profile + resume context |
| Job workflows | `/job-workflows` | Imperative Job Applicant pipeline runs (not the visual builder) |
| **IBKR Summary** | `/ibkr-summary` | Portfolio + day-wise plan vs executed; **Clear data…** for transactional reset (keeps budget Variables) — see help **20** |

### Company Tools

| Label | Route | Use for |
|-------|-------|---------|
| Workflows | `/workflows` | Custom visual workflows; editor at `/workflows/:id/edit` |
| **AI Employees** | `/workspace` | Hire AI employees, list team → workspace MD / tools / **templates** |
| Tools | `/content-tools` | Catalog, test invoke, logs, **Tools → Model** overrides |
| **Connectors** | `/connectors` | Link SaaS apps (OpenConnector) for **Connector** workflow nodes |
| MCP | `/integrations/mcp` | Register and test MCP servers |
| Custom scripts | `/integrations/custom-scripts` | Sandboxed Python/JS/LangGraph scripts |
| AgentExchange | `/agent-exchange` | Browse published A2A services (Public / Secured) |
| External AI | `/integrations/external-agents` | Onboard third-party A2A partners |

### Direct AI employee routes (not always in nav)

| Route | Purpose |
|-------|---------|
| `/agents/:agentId/chat` | 1:1 chat (attachments + inline media) |
| `/agents/:agentId/workspace` | Edit SOUL / AGENTS / MEMORY / TOOLS / OPS, tool grants, **Apply / Publish templates** |
| `/agents/:agentId/channels` | **Channels** wizard — Slack / WhatsApp BYOK for that AI employee |

## Admin navigation (admins only)

| Label | Route | Use for |
|-------|-------|---------|
| Admin | `/admin` | Users, platform LLM switch, workspace templates admin |
| A2A logs | `/admin/a2a-invocations` | Every A2A card / token / invoke attempt, including denials |
| **Crons** | `/admin/crons` | Platform cron registry — **Pause**, **Resume**, **Run now**; pause state survives restarts |
| Documents RAG | `/admin/documents-rag` | Platform OpenSearch help corpus |
| Tools Onboarding | `/admin/tool-onboarding` | Docker content-tool containers |
| **Platform feedback** | `/admin/platform-feedback` | Triage bugs / feedback / enhancements from COO tools (`open` → `implemented` / `rejected`) |

Admins also see Connectors (OAuth client config), MCP, Custom scripts, AgentExchange, External AI, and Profile.

## Mental model

Positioning: **AI Company OS** — see [`../AI-COMPANY-OS.md`](../AI-COMPANY-OS.md). Primitives: People, Employees, Departments, Knowledge, Tools, Policies, Workflows, Tasks, Approvals, Memory.

- **Talk to AI employees** → Home chat / Chat / Broadcast  
- **Reach them on WhatsApp/Slack** → employee **Channels** ([24-agent-channels.md](./24-agent-channels.md))  
- **Track work** → Kanban / Standups  
- **Repeat the same prompt on a schedule** → Scheduled goals ([28-scheduled-goals.md](./28-scheduled-goals.md)) or ask the COO  

- **Company knowledge** → Knowledge (Master Data)  
- **Browse files** → Content Explorer ([26-content-explorer.md](./26-content-explorer.md))  
- **Secrets** → API Keys (vault)  
- **Automate** → Workflows (+ Workflow Builder)  
- **Integrate SaaS** → Connectors  
- **Integrate tools/protocol** → MCP, External AI, Custom scripts, Tools  
- **3D / public rooms** → Avatars / Published Scenes  
- **Measure** → AI Snipper (usage) + Efficiency View (ops outcomes, per-employee budgets)
- **Cap spend / failures** → Efficiency View → Agent View → Edit budget  
- **Unblock a capped AI employee** → Efficiency View → Agent View → Reset usage  
- **Shrink your data footprint** → Profile → Data persistence, then Efficiency View → Org → Storage (MB)  
- **How do I…?** → Platform Help (docs **28** Scheduled goals, **29** Company setup, and the rest of this corpus)
- **First company shape** → Company setup ([29-company-setup.md](./29-company-setup.md))
- **File a platform bug (admins triage)** → ask COO / Platform Help (`platform_feedback_submit`) or Admin → **Platform feedback**