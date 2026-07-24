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
| How to use Flolah / MCP / A2A / nodes | **Platform Help** |
| Job discovery → apply pipeline | Job pipeline agents (via Job profiles/workflows) |

Prefer the **COO** for work that should be planned or handed to a specialist. Vague “help me” may stay with the COO; clear specialty asks get routed using agent purposes from org docs.

## Chat (`/agents/:id/chat`)

1. Open an agent from Dashboard or Agent Workspaces.
2. Type plain language and send.
3. **Tool icons** under replies show which Agent OS tools ran (Master Data, notify, email, workflows, …).
4. Sessions are per agent (and per tenant); history is stored for you.

Tips:
- One clear outcome per message works best (“Research X and summarize”).
- Multi-intent to the COO (two clear specialties) can create **two** Kanban cards.
- Ask the agent to **notify you** when you want a bell ping after async work — ordinary live chat replies should not spam the bell.
- If you want a specialist to **reach you**, say so (e.g. “have TechResearcher contact me”); that specialist rings the bell with a link to **their** chat.
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
| **AGENT-OS-OPS.md** | Shared operating rules for all specialists (learnings, Kanban self-check, Master Data, `notify_ceo`) — synced from platform templates; prefer not to hand-edit |

### Tools access

Workspace → **Tools access**: grant or revoke Agent OS content tools for that agent. Changes sync to OpenClaw allowlists (often without gateway restart).  

- **Tools access** = enforcement (what the agent may call).  
- **TOOLS.md** = instructions (how the LLM should use them). Use **Sync TOOLS.md from template** to refresh tool instructions from a workspace template without wiping SOUL/MEMORY.

### Workspace templates

On the agent workspace page:

1. **Apply template** — pick a **platform** template (visible to all CEOs). This **overwrites** SOUL, AGENTS, MEMORY, TOOLS, IDENTITY, and AGENT-OS-OPS. **ORG.md** and **POLICY.md** are left alone (org + your Policies page stay authoritative).
2. **Publish this agent as template** — share the current MD set as a new platform template (name it). Other CEOs can then Apply it.
3. Admins can also manage the template catalog under Admin (create / publish / unpublish).

Use templates to bootstrap a new specialist’s personality and ops rules, then edit. Prefer **Resync ORG** after Apply if peers look stale.

## Org chart and Resync

1. Review reporting lines on the Dashboard.
2. After structural changes, click **Resync ORG.md & AGENTS.md**.
3. Confirm specialists appear as COO peers when you expect specialty routing.

## Clear sessions

From agent list or workspace you can clear OpenClaw sessions if a chat is stuck or polluted — then start a fresh chat.
