# Dashboard, agents, chat, and workspaces

## Dashboard (`/`)

- **Org chart** of your agents (COO and specialists).
- **Add agent** — creates a full OpenClaw tenant agent for your CEO account (custom agent), with workspace files and default tool grants.
- **Standups** — create standup, chat with COO, get work from team, run COO summary, approve, delete.
- **Resync ORG.md & AGENTS.md** — after add/rename/reorganize agents, resync so every agent’s org docs list the correct CEO, peers, and COO delegatees.
- Per-agent **Chat** shortcuts; optional Edge TTS to read replies.

## Who to ask

| Need | Agent |
|------|-------|
| Plan / delegate / standups / email / notify | **COO** (BalServe) |
| Research | TechResearcher |
| Expenses / finance | ExpenseManager |
| Social / Facebook-style content | SocialAssistant |
| Build or fix a visual workflow | **Workflow Builder** |
| How to use Flowlah / MCP / A2A / nodes | **Platform Help** |
| Job discovery → apply pipeline | Job pipeline agents (via Job profiles/workflows) |

Prefer the **COO** for work that should be planned or handed to a specialist. Vague “help me” may stay with the COO; clear specialty asks get routed using agent purposes from org docs.

## Chat (`/agents/:id/chat`)

1. Open an agent from Dashboard or Agent Workspaces.
2. Type plain language and send.
3. **Tool icons** under replies show which Agent OS tools ran (Master Data, notify, email, workflows, …).
4. Sessions are per agent (and per tenant); history is stored for you.

Tips:
- One clear outcome per message works best (“Research X and summarize”).
- Ask the agent to **notify you** when you want a bell ping after async work.
- COO-native asks (workflows list/trigger, tools, Kanban, standups) usually stay with the COO.

## Agent Workspaces (`/workspace` → `/agents/:id/workspace`)

Edit personality and operating docs:

| File | Meaning |
|------|---------|
| **SOUL.md** | Voice, capabilities, boundaries |
| **AGENTS.md** | Operating contract, peers, tool playbook |
| **ORG.md** | Synced org roster (CEO, departments, peers) — prefer Resync over hand-edit |
| **MEMORY.md** | Long-lived facts |
| **TOOLS.md** | Instructions for when/how to use granted tools |

### Tools access

Workspace → **Tools access**: grant or revoke Agent OS content tools for that agent. Changes sync to OpenClaw allowlists (often without gateway restart).  

- **Tools access** = enforcement (what the agent may call).  
- **TOOLS.md** = instructions (how the LLM should use them). Sync TOOLS from template when needed.

## Org chart and Resync

1. Review reporting lines on the Dashboard.
2. After structural changes, click **Resync ORG.md & AGENTS.md**.
3. Confirm specialists appear as COO peers when you expect specialty routing.

## Clear sessions

From agent list or workspace you can clear OpenClaw sessions if a chat is stuck or polluted — then start a fresh chat.
