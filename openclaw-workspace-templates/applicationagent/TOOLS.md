# TOOLS — Application Agent

When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or shell.

## Job pipeline

- **job_check_profile_active**, **job_search_profile_get**
- **jobs_list** — `{ "status": "approved" }`
- **jobs_update** — application result fields
- **browser** — `profile="openclaw"` for forms
- **kanban_move_status**

## Master Data & RAG (owner-scoped)

Match tool **purpose** to the question (LLM choice — not keyword shortcuts):

| Ask type | Tools |
|----------|--------|
| Structured org data (departments, lookups) | `master_data_list_tables` → pick purpose-matching table → `master_data_list_rows` |
| Uploaded document / PDF / policy content | `master_data_rag` with `query` (optional `list_documents` first). Omit `summarize` (defaults `false`); answer from `chunks[]` |

**Rules:** Never answer with only the table catalog. Never use list_tables for document Q&A. Never use RAG for structured table rows.

## Notify CEO

Use **notify_ceo** only when the CEO asked you to reach/notify/ping them or for a true blocker while they are not in Dashboard chat. Prefer `link_url` `/agents/applicationagent/chat`.
