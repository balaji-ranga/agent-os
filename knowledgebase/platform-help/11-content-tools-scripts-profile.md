# Content tools, custom scripts, AI Snipper, Profile

## Content tools (`/content-tools`)

Catalog of Agent OS tools agents and workflows can call, for example:

- `summarize_url`, `generate_image`, `generate_video`
- Kanban helpers (`kanban_create_task`, `kanban_move_status`, …)
- `intent_classify_and_delegate`
- Workflow tools (`agent_workflow_list` / enquire / trigger / mutate / get_draft)
- `email_send`, `notify_ceo`
- Master Data (`master_data_list_tables`, row CRUD, `master_data_list_documents`, `master_data_rag`)
- `learnings_summary`, `brain_history`, `content_tools_enquire`, `browser`, …

### CEO actions

1. Browse tools (name, purpose).
2. **Test invoke** with JSON args; inspect **logs**.
3. Grant tools per agent under **Workspace → Tools access**.
4. In workflows, use a **Content Tool** node with the **exact** `toolName`.

Workflow Builder can recommend tools via `content_tools_enquire`.

### Shared specialist ops (AGENT-OS-OPS)

All specialists share platform rules in workspace **`AGENT-OS-OPS.md`** (also summarized in TOOLS.md). Expect agents to:

1. **`learnings_summary`** once at the start of non-trivial work (`topic` + ~30 days) and apply past CEO likes/rejects — skip for one-word greets.
2. **Own Kanban status** — `completed` only after a real deliverable; do not mark `failed` just because an optional Master Data insert/notify/email step failed.
3. **`master_data_list_tables` before insert** — never invent table names.
4. **`notify_ceo`** only when you asked to be reached / for true blockers / specialist “contact me” handoffs — not for ordinary live chat replies.
5. On **`summarize_url` 404/403**, retry live reputable sources or **browser**, never invent page content; still deliver a brief and complete the card if the brief is substantive.

## Custom scripts (`/integrations/custom-scripts`)

1. Upload Python / JS / LangGraph-style scripts.
2. Approve for sandbox execution.
3. Use from **Custom Script** nodes or Brain `customScriptMode` (off / fallback / post / only).

Keep scripts idempotent and avoid secrets in source — use env/platform config where possible.

## AI Snipper (`/ai-snipper`)

Usage analytics for **prompts**, **tokens** (estimated), **agents**, and **tool calls** over the last 7 / 14 / 30 days, with a timeline chart.

Use when you care about **LLM spend / activity**. For ops outcomes (task success, workflow runs), use **Efficiency View**.

## Efficiency View (`/efficiency`)

Ops dashboard next to AI Snipper:

| Metric | Meaning |
|--------|---------|
| Agents | Enabled agents on your account |
| Tasks automated | Kanban tasks assigned to agents in the range |
| Tasks ok / failed | Completed vs failed outcomes |
| Feedback positive % | Thumbs-up share of ratings |
| AI workflows | Definitions you own (incl. published count) |
| Successful / failed / total runs | Workflow run outcomes |

**Time switch:** last 7 days, 14 days, 1 month, 3 months, or **All**. Charts: Tasks, Feedback, Workflow runs.

## Profile (`/profile`)

Name, email, region, mobile, password, MFA, and **model provider** preference.

- OpenAI / OpenRouter need vault key **`Platform_BYOK`** under **API Keys** — see [15-api-keys-vault.md](./15-api-keys-vault.md).
- Prefer **Management → API Keys** for all long-lived secrets (never shown in platform access logs).

## How agents learn company knowledge

| Layer | What |
|-------|------|
| Workspace MD | SOUL / AGENTS / TOOLS / MEMORY / ORG / **AGENT-OS-OPS** always in agent context |
| Master Data RAG | Uploaded docs (including Platform Help) via `master_data_rag` |
| Skills | Shared OpenClaw skills (content-tools, agent-send) |
| Learnings | `learnings_summary` over past CEO feedback / Kanban decisions (required before non-trivial specialist work) |

Platform Help agent: short workspace instructions + RAG over these help documents (recommended). Do not dump the full help tree into SOUL.
