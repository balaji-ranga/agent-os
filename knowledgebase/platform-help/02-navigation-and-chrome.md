# Navigation and chrome

## Top bar

- **Left nav toggle** — collapse/expand the sidebar (icons only when collapsed).
- **Notification bell** — platform alerts (`notify_ceo`) and agent/standup responses. Each item shows its datetime. Hover a short snippet for the full title/body. Open linked chat or Kanban. Clear/dismiss items you have handled.
- **Profile menu** — Edit profile (`/profile`), light/dark theme, Logout.
- **Theme toggle** — sun/moon control in the top bar (also under Profile). Choice is saved in the browser.
- **Impersonation banner** — only when an admin is impersonating a CEO.

## CEO left navigation

### Management

| Label | Route | Use for |
|-------|-------|---------|
| Dashboard | `/` | Org chart, standups + COO chat, Resync ORG/AGENTS |
| Kanban | `/kanban` | Generic task board (agent / workflow / pipeline cards), CEO approvals, artifacts |
| Broadcast | `/broadcast` | Message many agents at once |
| Master Data | `/master-data` | Tables, documents, RAG, **Inbound attachments** |
| **Content Explorer** | `/content-explorer` | Browse uploaded + generated files (preview/download) |
| **API Keys** | `/api-keys` | Named secret vault (auto-seeded BYOK slots + workflow/MCP/Connector secrets) |
| Policies | `/policies` | CEO common guardrails for all agents + Brain nodes |
| AI Snipper | `/ai-snipper` | Prompt / token / tool-call usage timeline |
| **Browser Session** | `/browser-session` | Client Chrome relay, NL browser tasks, recorder recipes |
| **Efficiency View** | `/efficiency` | **Org** tab: agents, automated tasks, feedback, workflow run success/fail, Storage (MB). **Department** tab: month-to-date tokens vs department budget. **Agent View** tab: per-agent activity, outcomes, token/error budgets, **Reset usage** |
| **3D Avatars** | `/avatars` | Avatar models, Virtual Rooms, publish public scenes |
| **Published Scenes** | `/published-scenes` | Guest Virtual Room links (`/p/vr/:slug`) |

### Prebuilt Workflows

| Label | Route | Use for |
|-------|-------|---------|
| Job profiles | `/job-profiles` | Job-search profile + resume context |
| Job workflows | `/job-workflows` | Imperative Job Applicant pipeline runs (not the visual builder) |

### Agentic Workflows

| Label | Route | Use for |
|-------|-------|---------|
| Workflows | `/workflows` | Custom visual workflows; editor at `/workflows/:id/edit` |
| Agent Workspaces | `/workspace` | Add agent, list agents → workspace MD / tools / **templates** |
| Tools | `/content-tools` | Catalog, test invoke, logs |
| **Connectors** | `/connectors` | Link SaaS apps (OpenConnector) for **Connector** workflow nodes |
| MCP | `/integrations/mcp` | Register and test MCP servers |
| Custom scripts | `/integrations/custom-scripts` | Sandboxed Python/JS/LangGraph scripts |
| AgentExchange | `/agent-exchange` | Browse published A2A workflow agents (Public / Secured) |
| External agents | `/integrations/external-agents` | Onboard third-party A2A agents |

### Direct agent routes (not always in nav)

| Route | Purpose |
|-------|---------|
| `/agents/:agentId/chat` | 1:1 chat (attachments + inline media) |
| `/agents/:agentId/workspace` | Edit SOUL / AGENTS / MEMORY / TOOLS / OPS, tool grants, **Apply / Publish templates** |
| `/agents/:agentId/channels` | **Channels** wizard — Slack / WhatsApp BYOK for that agent |

## Admin navigation (admins only)

| Label | Route | Use for |
|-------|-------|---------|
| Admin | `/admin` | Users, platform LLM switch, workspace templates admin |
| A2A logs | `/admin/a2a-invocations` | Every A2A card / token / invoke attempt, including denials |
| **Crons** | `/admin/crons` | Platform cron registry — **Pause**, **Resume**, **Run now**; pause state survives restarts |
| Documents RAG | `/admin/documents-rag` | Platform OpenSearch help corpus |
| Tools Onboarding | `/admin/tool-onboarding` | Docker content-tool containers |
| **Platform feedback** | `/admin/platform-feedback` | Triage bugs / feedback / enhancements from COO tools (`open` → `implemented` / `rejected`) |

Admins also see Connectors (OAuth client config), MCP, Custom scripts, AgentExchange, External agents, and Profile.

## Mental model

- **Talk to people (agents)** → Dashboard / Chat / Broadcast  
- **Reach agents on WhatsApp/Slack** → agent **Channels** ([24-agent-channels.md](./24-agent-channels.md))  
- **Track work** → Kanban / Standups  
- **Company facts** → Master Data  
- **Browse files** → Content Explorer ([26-content-explorer.md](./26-content-explorer.md))  
- **Secrets** → API Keys (vault)  
- **Automate** → Workflows (+ Workflow Builder agent)  
- **Integrate SaaS** → Connectors  
- **Integrate tools/protocol** → MCP, External agents, Custom scripts, Tools  
- **3D / public rooms** → Avatars / Published Scenes  
- **Measure** → AI Snipper (usage) + Efficiency View (ops outcomes, per-agent budgets)
- **Cap agent spend / failures** → Efficiency View → Agent View → Edit budget  
- **Unblock a capped agent** → Efficiency View → Agent View → Reset usage  
- **Shrink your data footprint** → Profile → Data persistence, then Efficiency View → Org → Storage (MB)  
- **How do I…?** → Platform Help agent or Master Data RAG docs
- **File a platform bug (admins triage)** → ask COO / Platform Help (`platform_feedback_submit`) or Admin → **Platform feedback**