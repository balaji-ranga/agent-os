# Navigation and chrome

## Top bar

- **Left nav toggle** — collapse/expand the sidebar (icons only when collapsed).
- **Notification bell** — platform alerts (`notify_ceo`) and agent/standup responses. Each item shows its datetime. Hover a short snippet for the full title/body. Open linked chat or Kanban. Clear/dismiss items you have handled.
- **Profile menu** — Edit profile (`/profile`), Logout.
- **Impersonation banner** — only when an admin is impersonating a CEO.

## CEO left navigation

### Management

| Label | Route | Use for |
|-------|-------|---------|
| Dashboard | `/` | Org chart, add agent, standups + COO chat, Resync ORG/AGENTS |
| Kanban | `/kanban` | Generic task board (agent / workflow / pipeline cards), CEO approvals, artifacts |
| Broadcast | `/broadcast` | Message many agents at once |
| Master Data | `/master-data` | Tables, documents, RAG |
| **API Keys** | `/api-keys` | Named secret vault (BYOK `Platform_BYOK`, workflow/MCP/Connector secrets) |
| Policies | `/policies` | CEO common guardrails for all agents + Brain nodes |
| AI Snipper | `/ai-snipper` | Prompt / token / tool-call usage timeline |
| **Efficiency View** | `/efficiency` | **Org** tab: agents, automated tasks, feedback, workflow run success/fail. **Agent View** tab: per-agent activity, outcomes, token/error budgets |

### Prebuilt Workflows

| Label | Route | Use for |
|-------|-------|---------|
| Job profiles | `/job-profiles` | Job-search profile + resume context |
| Job workflows | `/job-workflows` | Imperative Job Applicant pipeline runs (not the visual builder) |

### Agentic Workflows

| Label | Route | Use for |
|-------|-------|---------|
| Workflows | `/workflows` | Custom visual workflows; editor at `/workflows/:id/edit` |
| Agent Workspaces | `/workspace` | List agents → workspace MD / tools / **templates** |
| Content tools | `/content-tools` | Catalog, test invoke, logs |
| **Connectors** | `/connectors` | Link SaaS apps (OpenConnector) for **Connector** workflow nodes |
| MCP | `/integrations/mcp` | Register and test MCP servers |
| Custom scripts | `/integrations/custom-scripts` | Sandboxed Python/JS/LangGraph scripts |
| AgentExchange | `/agent-exchange` | Browse published A2A workflow agents (Public / Secured) |
| External agents | `/integrations/external-agents` | Onboard third-party A2A agents |

### Direct agent routes (not always in nav)

| Route | Purpose |
|-------|---------|
| `/agents/:agentId/chat` | 1:1 chat |
| `/agents/:agentId/workspace` | Edit SOUL / AGENTS / MEMORY / TOOLS / OPS, tool grants, **Apply / Publish templates** |

## Admin navigation (admins only)

Admin home `/admin` (users, platform LLM switch, workspace templates admin), plus Connectors (OAuth client config), MCP / custom scripts / AgentExchange / external agents / profile.

## Mental model

- **Talk to people (agents)** → Dashboard / Chat / Broadcast  
- **Track work** → Kanban / Standups  
- **Company facts** → Master Data  
- **Secrets** → API Keys (vault)  
- **Automate** → Workflows (+ Workflow Builder agent)  
- **Integrate SaaS** → Connectors  
- **Integrate tools/protocol** → MCP, External agents, Custom scripts, Content tools  
- **Measure** → AI Snipper (usage) + Efficiency View (ops outcomes, per-agent budgets)
- **Cap agent spend / failures** → Efficiency View → Agent View → Edit budget  
- **How do I…?** → Platform Help agent or Master Data RAG docs
