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

## Custom scripts (`/integrations/custom-scripts`)

1. Upload Python / JS / LangGraph-style scripts.
2. Approve for sandbox execution.
3. Use from **Custom Script** nodes or Brain `customScriptMode` (off / fallback / post / only).

Keep scripts idempotent and avoid secrets in source — use env/platform config where possible.

## AI Snipper (`/ai-snipper`)

Analytics timeline for usage, tokens, and prompts — useful to see which agents/tools burn budget.

## Profile (`/profile`)

Name, email, region, mobile, password, MFA, and **BYOK** model provider/API key when available.

## How agents learn company knowledge

| Layer | What |
|-------|------|
| Workspace MD | SOUL / AGENTS / TOOLS / MEMORY / ORG always in agent context |
| Master Data RAG | Uploaded docs (including Platform Help) via `master_data_rag` |
| Skills | Shared OpenClaw skills (content-tools, agent-send) |
| Learnings | `learnings_summary` over past CEO feedback / Kanban decisions |

Platform Help agent: short workspace instructions + RAG over these help documents (recommended). Do not dump the full help tree into SOUL.
