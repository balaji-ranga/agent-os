# Navigation and chrome

## Top bar

- **Left nav toggle** — collapse/expand the sidebar (icons only when collapsed).
- **Nav sections** (Settings, Run & Operate, Prebuilt Workflows, Company Tools, …) start **collapsed by default**. Expand with the section chevron; choices remember in this browser (`agent-os-nav-section-v2:*` keys).
- **Notification bell** — platform alerts (`notify_ceo`) and agent/standup responses. Each item shows its datetime. Hover a short snippet for the full title/body. Open linked chat or Kanban. Clear/dismiss items you have handled.
- **Profile menu** — Edit profile (`/profile`), **Company setup** (`/company-setup` — first-run company wizard; [29-company-setup.md](./29-company-setup.md)), **Onboarding** (`/onboarding` — freeform org draft/Review/Apply; [27-onboarding-helper.md](./27-onboarding-helper.md)), light/dark theme, Logout.
- **Theme toggle** — sun/moon control in the top bar (also under Profile). Choice is saved in the browser.
- **Impersonation banner** — only when an admin is impersonating a CEO.
- **Scrollbars** — hidden platform-wide (nav, panels, tables). Content still scrolls with trackpad/wheel/touch.

## CEO left navigation

Top-level (always shown; cannot hide in Menu visibility):

| Label | Route | Use for |
|-------|-------|---------|
| Home | `/` | Executive chat (COO / default) |
| **Digest** | `/this-week` | Weekly company pulse: AI workers, tasks, Time Saved, Est. Value (per-agent $/hr), insights. |
| Workspace | `/work` | Daily operating workspace — **open Kanban tasks**, AI team, activity, command bar (same task source as **/kanban**) |

### Settings (nav chrome)

| Label | Route | Use for |
|-------|-------|---------|
| **Workspace Builder** | `/workspace-designer` | Visual designer for owner-scoped Workspace pages (/work): KPI cards, charts, tables, activity, chat; bind presets / REST / master data / RAG. Publish default is operating workspace, not Digest. |
| **Menu visibility** | `/nav-menus` | Show/hide sidebar menus (prefs on your account). Not a security control; CRM/ERP still require Business Core entitlements. |
| **IP Whitelists** | `/settings/ip-whitelists` | Central firewall for laptop packages and public A2A: IBKR bridge webhooks, Workflow Download for Windows, A2A public access, Browser Session worker. Federated UIs write the same store. |
| **Tokens management** | `/settings/tokens` | List and revoke issued external package tokens (workflow desktop, IBKR bridge, Browser Session). Masked prefixes only. |
| **Update Company Details** (avatar menu) | `/update-company-details` | Edit company identity fields stored in Knowledge `company_memory` (mission, DNA, name, industry). |
| **API Keys** | `/api-keys` | Named secret vault (auto-seeded BYOK slots + workflow/MCP/Connector secrets) |

### Run & Operate

| Label | Route | Use for |
|-------|-------|---------|
| My Org / Dashboard | `/org` | Org chart, standups + COO chat, Resync ORG/AGENTS |
| Kanban | `/kanban` | Work tasks (AI employee / workflow / pipeline cards), CEO approvals, artifacts |
| **Scheduled goals** | `/scheduled-goals` | Recurring CEO prompts (**hourly** / daily / weekdays / weekly); create **and edit**; pause survives restarts. Also via COO chat. See [28-scheduled-goals.md](./28-scheduled-goals.md) |
| Broadcast | `/broadcast` | Message many AI employees at once |
| **Knowledge** | `/master-data` | Company knowledge: tables, documents, RAG, **Inbound attachments** (Master Data) |
| **Content Explorer** | `/content-explorer` | Browse uploaded + generated files (preview/download) |
| Policies | `/policies` | CEO common guardrails for all AI employees + Brain nodes |
| AI Snipper | `/ai-snipper` | Prompt / token / tool-call usage timeline |
| **Browser Session** | `/browser-session` | Managed Playwright, Client Chrome relay, recipes; multi-user also uses Connectors **Browser Session package** (local worker) |
| **Efficiency View** | `/efficiency` | **Org** tab: AI employees, automated tasks, feedback, workflow run success/fail, Storage (MB). **Department** tab: month-to-date tokens vs department budget. **Agent View** tab: per-employee activity, outcomes, token/error budgets, **Reset usage** |
| **CRM** | `/crm` | Shown only when Profile CRM = Twenty (platform embed) |
| **ERP** | `/erp` | Shown only when Profile ERP = ERPNext (platform embed) |
| **3D Avatars** | `/avatars` | Avatar models, Virtual Rooms, publish public scenes |
| **Published Scenes** | `/published-scenes` | Guest Virtual Room links (`/p/vr/:slug`) |

**Timezone:** all board and workspace datetimes use **Profile → Display timezone**.

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
- **Settings** → Tokens management (external packages) + IP Whitelists + API Keys (vault). Help: [33](./33-ip-whitelists.md), [34](./34-tokens-management.md).  
- **Automate** → Workflows (+ Workflow Builder)  
- **Integrate SaaS** → Connectors  
- **Integrate tools/protocol** → MCP, External AI, Custom scripts, Tools  
- **3D / public rooms** → Avatars / Published Scenes  
- **Measure** → AI Snipper (usage) + Efficiency View (ops outcomes, per-employee budgets)
- **Cap spend / failures** → Efficiency View → Agent View → Edit budget  
- **Unblock a capped AI employee** → Efficiency View → Agent View → Reset usage  
- **Shrink your data footprint** → Profile → Data persistence, then Efficiency View → Org → Storage (MB)  
- **How do I…?** → Platform Help (docs **28** Scheduled goals, **29** Company setup, **35** Update Company Details, and the rest of this corpus)
- **First company shape** → Company setup ([29-company-setup.md](./29-company-setup.md))
- **Update mission / DNA later** → avatar **Update Company Details** ([35-update-company-details.md](./35-update-company-details.md))
- **File a platform bug (admins triage)** → ask COO / Platform Help (`platform_feedback_submit`) or Admin → **Platform feedback**

## Digest (This Week Digest)

Top-nav **Digest** (`/this-week`) shows KPIs (AI workers, tasks completed, estimated Time Saved and Est. Value Delivered), organization and AI worker highlights, **goal plans** (2 most recent for the selected week; **View all plans** opens `/goal-plans?offset=` for that week), top workflows, task performance donut, activity timeline, and **Insights & recommendations**. Click the **i** on Time Saved / Est. Value for formulas.

### Metric formulas

- **Tasks completed** = Kanban cards with status `completed`/`done` this Mon-Sun week **plus** workflow runs with status `completed` (owner-scoped).
- **Time Saved (hours)** = `round((tasks_completed x minutes_per_task) / 60, 1)`.
  - `minutes_per_task` from env `THIS_WEEK_MINUTES_PER_TASK` (default **45**, minimum 15). Platform proxy only - not timesheets.
- **Est. Value Delivered (USD)** = sum over each completed unit of `(minutes_per_task / 60) x agent_hourly_rate_usd`, rounded.
  - Each AI employee has **hourly_rate_usd** set at **Hire AI employee** (default **$10/hr**). Change via agent PATCH.
  - Completed **workflow runs** and **unassigned** Kanban tasks use platform default `THIS_WEEK_VALUE_USD_PER_HOUR` (default **$10/hr**).
  - **Not** CRM revenue, invoices, pipeline, or task tags. Distinct from **status_checker** (task counts only).
- Insights come from a separate assessor (`this-week-digest-insights`) covering CRM readiness, scheduled goals, workflow failures, knowledge growth, and token use.
- Data: authenticated `GET /api/this-week-digest`. COO tool **this_week_digest** returns the same KPIs + methodology so chat can explain dollars/hours without guessing.

## Home operational effectiveness (OEI)

Home (`/`) shows an **Operational Effectiveness Index (OEI)** score **0–100** (Green ≥ **75**, Amber 50–74, Red 0–49) over a rolling **14-day** window. Domains (equal-weight mean): vision, org, goals, workflows, autonomy, CRM (platform Twenty **or** MCA CRM connector), governance. Rules-only (no LLM / no Digest dollars).

**Goal KPIs:** **Goal runs (14d)** counts **firings** (`scheduled_goal_runs`), not “distinct goals that ran once.” A single daily goal with seven successful days shows **~7 runs**, not **1**. Distinct-goal count is a separate KPI.

Use the Home **i** popover for domain scores and improve links. REST: `GET /api/operational-effectiveness` (owner-scoped). COO: **`operational_effectiveness`**. Full guide: [36-operational-effectiveness.md](./36-operational-effectiveness.md).


### Hire rate

When hiring under **AI Employees** (`/workspace`) or Org Design, set **Hourly value rate (USD)** (default 10). That rate powers Digest Est. Value for tasks assigned to that AI employee.

## Operating Workspace (`/work`)

Daily desk for open work (not Digest). Default board binds **Open tasks** to `workspace.tasks` — the same owner-scoped Kanban rows as **/kanban** (including unassigned cards). Metrics tile **Open tasks** uses that count.

- **Multi-tenant CEOs:** open cards live on the platform Kanban store with `owner_user_id`; Workspace merges platform (+ optional tenant DB) so **Open tasks never goes empty when Kanban still has open work**.
- Customize layout/bindings in **Workspace Builder** below; **Seed operating template** restores the classic layout if you blank the board.

## Workspace Builder

**Workspace Builder** (`/workspace-designer`) designs owner-scoped **Workspace** pages for `/work` (not Digest). Components: KPI cards, charts, tables, activity, chat panel, layouts. Each component can bind to **presets**, allowlisted **REST** paths, **master data tables**, or **Knowledge RAG**. Pages are stored as JSON (`company_workspace_boards`) so future AI workers / Workflow Builder can author them too.

- **Preview Live Data** hydrates bindings via `GET /api/workspace-boards/:slug/render`.
- **Set as Default** publishes that page to the top-nav **Workspace** menu (`/work`); only a designed default replaces the classic hard-built Workspace.
- **Seed operating template** installs a page that reconstructs the classic Operating Workspace layout (metrics + open tasks + AI workers + activity).
- Task presets (`workspace.tasks`, `workspace.metrics.tasks_open`) always hydrate from owner-scoped Kanban (**same board as /kanban**).
- Auth / owner entitlements apply on all APIs; CRM components may require Business Core CRM.
