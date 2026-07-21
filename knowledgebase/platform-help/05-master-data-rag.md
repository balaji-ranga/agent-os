# Master Data and document RAG

## Open Master Data (`/master-data`)

Two pillars:

1. **Tables** — structured rows/columns (CSV-friendly).
2. **Documents** — uploaded files agents search with keyword RAG.

## Tables

- New CEOs get a **departments** table (Executive, Research, Finance, Social, Engineering, Operations, Job Pipeline, …).
- Add columns and rows; import CSV when available.
- Capture a **purpose/description** on the table so agents know what it is for.
- Agents with Master Data tools can list tables, list/insert/update/delete **rows**. They generally **cannot** create/alter/drop tables from chat — that stays in the UI.

Example asks: “list departments”, “add Engineering if missing”.

## Documents and RAG

- Upload policies, handbooks, and guides.
- New accounts include **Flowlah Platform Help** documents (and often a short User Guide) so agents can answer “how do I use Flowlah?”.
- RAG is **keyword chunk search** over SQLite chunks (not vector embeddings). Clear headings and repeated keywords improve hits.
- UI may offer a RAG query box; agents use **`master_data_list_documents`** then **`master_data_rag`**.

### Agent pattern for help questions

1. `master_data_list_documents` — confirm Platform Help docs exist.
2. `master_data_rag` with a focused query (e.g. “workflow IF node input mapping”, “register MCP server”).
3. Answer from retrieved chunks; do not invent UI steps that contradict the docs.

## Workflow Master Data node

In custom workflows, the **Master Data** node can query tables or RAG documents mid-graph (`mode`: auto / table / rag). See the workflow nodes reference.
