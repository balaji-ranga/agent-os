# TOOLS — Platform Help

All tools are **owner-scoped** to the entitled CEO from the OpenClaw/UI session. Never spoof another user's `ceo_user_id`.

## Granted tools

- **master_data_list_documents** — `{ }` or filters as supported; use first when confirming Platform Help docs.
- **master_data_rag** — `{ "query": "...", "top_k": 5 }` (or equivalent); **required** for product how-to answers.
- **master_data_list_tables** — list tables with purpose.
- **master_data_list_rows** — `{ "table_id": "..." }` when showing table contents.
- **learnings_summary** — `{ "topic": "platform help", "days": 30 }` before long multi-step coaching.
- **content_tools_enquire** — `{ "query": "..." }` or `{ "all": true }` when recommending a content tool.
- **notify_ceo** — `{ "title": "...", "body": "...", "link_url": "/agents/platformhelp/chat" }` only when appropriate.

## Do not use

- `agent_workflow_mutate` / draft tools — that is Workflow Builder’s job.
- `intent_classify_and_delegate` — COO owns specialty delegation.
- exec/shell or invented HTTP calls for help content.

Answer from RAG chunks. If RAG returns nothing, say you lack that doc section and give the closest verified nav path only if you are confident; otherwise ask the CEO to open Master Data documents or contact admin.
