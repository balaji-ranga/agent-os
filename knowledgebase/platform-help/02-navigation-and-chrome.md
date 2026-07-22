# Navigation and chrome

## Top bar

- **Left nav toggle** — collapse/expand the sidebar (icons only when collapsed).
- **Notification bell** — platform alerts (`notify_ceo`) and agent/standup responses. Hover a short snippet for the full title/body. Open linked chat or Kanban. Clear/dismiss items you have handled.
- **Profile menu** — Edit profile (`/profile`), Logout.
- **Impersonation banner** — only when an admin is impersonating a CEO.

## CEO left navigation

### Management

| Label | Route | Use for |
|-------|-------|---------|
| Dashboard | `/` | Org chart, add agent, standups + COO chat, Resync ORG/AGENTS |
| Kanban | `/kanban` | Task board, CEO approvals from workflows, artifacts |
| Broadcast | `/broadcast` | Message many agents at once |
| Master Data | `/master-data` | Tables, documents, RAG |
| AI Snipper | `/ai-snipper` | Token / prompt / activity analytics |

### Prebuilt Workflows

| Label | Route | Use for |
|-------|-------|---------|
| Job profiles | `/job-profiles` | Job-search profile + resume context |
| Job workflows | `/job-workflows` | Imperative Job Applicant pipeline runs (not the visual builder) |

### Agentic Workflows

| Label | Route | Use for |
|-------|-------|---------|
| Workflows | `/workflows` | Custom visual workflows; editor at `/workflows/:id/edit` |
| Agent Workspaces | `/workspace` | List agents → workspace MD / tools |
| Content tools | `/content-tools` | Catalog, test invoke, logs |
| MCP | `/integrations/mcp` | Register and test MCP servers |
| Custom scripts | `/integrations/custom-scripts` | Sandboxed Python/JS/LangGraph scripts |
| AgentExchange | `/agent-exchange` | Browse published A2A workflow agents (Public / Secured) |
| External agents | `/integrations/external-agents` | Onboard third-party A2A agents |

### Direct agent routes (not always in nav)

| Route | Purpose |
|-------|---------|
| `/agents/:agentId/chat` | 1:1 chat |
| `/agents/:agentId/workspace` | Edit SOUL / AGENTS / MEMORY / TOOLS, tool grants |

## Admin navigation (admins only)

Admin home `/admin` (users), plus shared MCP / custom scripts / AgentExchange / external agents / profile.

## Mental model

- **Talk to people (agents)** → Dashboard / Chat / Broadcast  
- **Track work** → Kanban / Standups  
- **Company facts** → Master Data  
- **Automate** → Workflows (+ Workflow Builder agent)  
- **Integrate** → MCP, External agents, Custom scripts, Content tools  
- **How do I…?** → Platform Help agent or Master Data RAG docs
