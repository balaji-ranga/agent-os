# Dashboard, agents, chat, and workspaces

## Dashboard (`/org` — My Org)

- **Org chart** of your AI employees (COO and specialists) and **people** (human employees). Home chat is at **`/`** (COO by default).
- **People** tab — invite employees (name, email, phone → invite email), assign **CEO Delegate** or **Member** (or a custom role), place them in a department. Employees inherit the **CEO company** (tools, Knowledge, CRM/ERP binds). AgentSystem workspaces stay on the CEO. Guide: [45-company-people.md](./45-company-people.md).
- **Standups** — create standup, chat with COO, get work from team, run COO summary, approve, delete.
- **Remove agent** — deletes the agent's chat history, standup responses, delegation records and tool grants. **Kanban cards are kept and unassigned** so the board history survives, and any agents reporting to it move up to its parent. The COO cannot be removed. Removal sticks: the agent does not reappear after a restart or a **Sync from AgentSystem**.
- **Resync ORG.md & AGENTS.md** — after add/rename/reorganize agents, resync so every agent’s org docs list the correct CEO, peers, and COO delegatees. On the COO’s **AGENTS.md**, only the live roster sections are refreshed (CEO for this org, agent table, external/A2A leaf members, session keys). **Role / Priorities / Tools / Guardrails / any custom sections you edited by hand are preserved.**
- Per-agent **Chat** shortcuts; optional Edge TTS to read replies.

To **add a new agent**, use **AI Employees** (nav → **Hire AI employee**, optional **role template**: Slow Caller / Realtime Caller), or Org chart → **Design** on My Org.

Public walkthrough (create departments, drag tiles, Resync): [https://flolah.cloud/docs/setup/org-and-departments/](https://flolah.cloud/docs/setup/org-and-departments/).

## Who to ask

| Need | Agent |
|------|-------|
| Plan / delegate / standups / email / notify | **COO** (BalServe) |
| Research | TechResearcher |
| Expenses / finance | ExpenseManager |
| Social / Facebook-style content | SocialAssistant |
| Build or fix a visual workflow | **Workflow Builder** |
| How to use Flolah / MCP / A2A / nodes | **Platform Help** |
| Sales pipeline (Lead → Prospect → Won → ERP Order) | **CRM Maker** / **CRM Checker** (Twenty or ERPNext Sales; help **40**) |
| Voice support (WhatsApp notes or live WebRTC) | **Slow Caller** / **Realtime Caller** (help **46**) |
| Books (quote → order → invoice → cash / PO → bill) | **ERP Maker A/B** / **ERP Checker** (ERPNext; help **39**) |
| Job discovery → apply pipeline | Job pipeline agents (via Job profiles/workflows) |

Prefer the **COO** for work that should be planned or handed to a specialist. Vague “help me” may stay with the COO; clear specialty asks get routed using agent purposes from org docs.

**Specialty-first (all CEOs):** When you name a clear research/market/design/etc. outcome (including Mag7-style one-shots), the COO **delegates full context** to the matching specialty agent — not a thin “Delegate to MarketWatcher…” paraphrase and not a long solo answer. Follow-ups like “what about marketwatcher?” keep the **original deliverable** (e.g. Mag7 insights) in the handoff. See COO workspace `AGENTS.md` **Specialty-first** + shared `AGENT-OS-OPS.md`.

## Chat (`/` home or `/agents/:id/chat`)

1. Home (`/`) opens chat with the **COO by default**; use the **Chat with** picker for other agents. Home may show **OEI** (operational effectiveness 0–100) and related KPI chips — score is rules-only for your CEO scope; full explainability and goal-run KPIs: [36-operational-effectiveness.md](./36-operational-effectiveness.md). **My Org** (`/org`) has the org chart and standups.
2. Type plain language and send. Use the **paperclip** to attach documents, images, audio, or video (size limits apply; ~40MB class). Attachments are stored as Master Data documents and mirrored under workspace **`inbound/attachments/`** so tools like `speech_stt` can use the path. Agent replies render common **markdown** in the web chat (bold, italics, lists, headings, `code`, links) — the same markup WhatsApp understands. Each assistant turn shows the employee **icon + name**.
3. **History** and **Browser session** side panes are **hidden by default**. Use the clock (history) and window (browser session) icons next to **New chat** to open or close them. **New chat** archives the current thread (title from the first user message). On local Ollama, that title is heuristic — the button should not stay on **Archiving…**.
4. **Tool icons** under replies show which tools ran for that turn: **Agent OS content tools** (Master Data, notify, email, workflows, `speech_tts`, `generate_image`, `market_history`, …) **and native AgentSystem tools** when they appear in the agent session transcript (`browser`, `image`, `cron`). Expand a chip to see request/response (large browser payloads are truncated).
5. **Generated media plays inline** while you are logged in: images, audio (TTS), and video use authenticated fetch (not a public link). Bare `/api/media` URLs without a session return 401. TTS plays **once** per clip — the `MEDIA:` line and the `speech_tts` tool result are the same file (not a second WAV artifact player). Gateway **Message failed** banners (native `message` tool, not the web copy) are hidden.
6. Agents should paste **`MEDIA:/abs/path`** (tool `paste_exactly`) for WhatsApp parity — not world-open HTTPS. See [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md) and [24-agent-channels.md](./24-agent-channels.md). Do **not** have the employee call native `message` with `target: "whatsapp"`; scheduled-goal / PA copies are sent by the platform.
7. Optional **mic** (Whisper) and **Speak reply** (Piper) when free speech is deployed — [25-speech-and-published-scenes.md](./25-speech-and-published-scenes.md). **Call** starts a live WebRTC session (OpenAI Realtime BYOK) — [46-voice-caller-employees.md](./46-voice-caller-employees.md).
8. Sessions are per agent (and per tenant); history is stored for you.

Tips:
- One clear outcome per message works best (“Research X and summarize”).
- Multi-intent to the COO (two clear specialties) can create **two** Kanban cards.
- Ask the agent to **notify you** when you want a bell ping after async work — ordinary live chat replies should not spam the bell.
- If you want a specialist to **reach you**, say so (e.g. “have TechResearcher contact me”); that specialist rings the bell with a link to **their** chat.
- COO-native asks (workflows list/trigger, tools, Kanban, standups) usually stay with the COO.
- Channel files (WhatsApp/Telegram): the COO is prompted to list inbound, **index RAG-able docs**, then RAG — images/audio stay via analyze/STT.
- WhatsApp / Slack: configure **Channels** on the agent (`/agents/:id/channels`).
## Agent Workspaces (`/workspace` → `/agents/:id/workspace`)

**Add agent / Hire AI employee** — creates a full AgentSystem tenant agent for your CEO account (custom agent), with workspace files and default tool grants. Optionally set a **monthly token budget** and **error budget %** at creation (see [18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md)). Choose an **icon or image** (default robot icon if none). The same icon shows in chat (next to the employee name), Agent Workspace, and Agent Exchange.

**Publish to Agent Exchange** — from the employee list or workspace, publish as **Flolah** (other Flolah CEOs can Add to org → imported into their workspace + org) or **Public** (internet A2A). Unpublish from the same modal or Exchange **⋯**. Workflow A2A publish is separate and unchanged — see [09-a2a-agent-exchange.md](./09-a2a-agent-exchange.md).

Edit personality and operating docs:

| File | Meaning |
|------|---------|
| **SOUL.md** | Voice, capabilities, boundaries |
| **AGENTS.md** | Operating contract, peers, tool playbook |
| **ORG.md** | Synced org roster (CEO, departments + purpose, peers, external/A2A leaf members) — prefer Resync over hand-edit |
| **MEMORY.md** | Long-lived facts |
| **TOOLS.md** | Instructions for when/how to use granted tools |
| **AGENT-OS-OPS.md** | Shared operating rules for all specialists (learnings, Kanban self-check, Master Data, `notify_ceo`) — synced from platform templates; prefer not to hand-edit |

### Tools access

Workspace → **Tools access**: grant or revoke Agent OS content tools for that agent. Changes sync to AgentSystem allowlists (often without gateway restart).  

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

From agent list or workspace you can clear AgentSystem sessions if a chat is stuck or polluted — then start a fresh chat.

If **many chats queue then fail**, the gateway lane is full (not a dirty thread). CEOs: pause noisy scheduled goals and wait. Admins: **Admin → AgentSystem recovery** (help **43**).
