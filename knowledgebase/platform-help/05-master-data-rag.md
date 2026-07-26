# Master Data and document RAG

## Open Master Data (`/master-data`)

Two pillars:

1. **Tables** — structured rows/columns (CSV-friendly). Still stored in the CEO SQLite database.
2. **Documents** — uploaded files indexed in **OpenSearch** (not SQLite) for search and RAG.

## Tables

- New CEOs get a **departments** table (Executive, Research, Finance, Social, Engineering, Operations, Job Pipeline, …) with `name`, **`purpose`** and **`monthly_token_budget`** columns. Purpose is synced into agent workspaces via ORG.md — see [18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md).
- Add columns and rows; import CSV when available.
- Capture a **purpose/description** on the table so agents know what it is for.
- Agents with Master Data tools can list tables, list/insert/update/delete **rows**. They generally **cannot** create/alter/drop tables from chat — that stays in the UI.
- Before insert/update, agents should call **`master_data_list_tables`** and use a real table name. They must **not** invent tables (e.g. do not assume a `recipes` table exists). Recipe/image asks are usually chat deliverables unless you asked to store a row.

Example asks: “list departments”, “add Engineering if missing”.

## Documents and RAG (OpenSearch)

- Each CEO has **two isolated OpenSearch indices**:
  - `user_{fingerprint}_docs_meta` — documentID, source, uploaded_by (user or agent), tags, uploaded date, storage path, excerpt
  - `user_{fingerprint}_docs_search` — chunk text for BM25 search + optional embedding vectors for RAG
- Platform help / README live in **`platform_docs_meta`** / **`platform_docs_search`** (admin-managed). They are **not** copied into each CEO index.
- File **bytes** stay on disk under `master-data/{owner}/docs/`; only meta + chunks are indexed in OpenSearch.
- Upload policies, handbooks, and guides as **PDF, Word (.docx), Excel (.xlsx/.xls), or text** (`.txt`, `.md`, `.csv`, …).
- Text is extracted on upload and indexed. Image-only PDFs and legacy `.doc` (not `.docx`) are not indexed well — convert or paste text.
- Use **Reindex** (or **Reindex all for RAG**) on Master Data so chunks are rebuilt from the stored files.
- Retrieval uses OpenSearch full-text (BM25); when an embedding API key is configured, k-NN vectors are stored and used for hybrid ranking.
- UI may offer a RAG query box; agents use **`master_data_list_documents`** then **`master_data_rag`**. For the **agent tool**, prefer omitting `summarize` (defaults **false**) and answer from returned `chunks[]` yourself. The **Master Data UI** RAG box and the workflow **Master Data** node default to `summarize: true` (LLM answer).

### Platform Help vs your uploads

| Who | Where | How to manage |
|-----|--------|----------------|
| CEO uploads | Your user OpenSearch indices | Master Data → Documents |
| Platform Help / User Guide | Platform OpenSearch indices | Admin → **Documents RAG** |
| Platform Help agent | Same platform indices (backend routes `platformhelp` automatically) | No OpenClaw config change |

Admins can open **OpenSearch console** (Dashboards) from Admin or Documents RAG — same pattern as OpenConnector: nginx `/opensearch/` → backend BFF, admin session cookie only. Ports `9200`/`5601` are **not** published to the internet.

### Purge uploads

| Action | What happens |
|--------|----------------|
| **Delete** on one of your uploads | Removes that document from OpenSearch **and** disk. |
| **Purge all uploads** | Removes **all** of your uploaded documents in one step. Confirm carefully — it cannot be undone. |

### Agent pattern for help questions (Platform Help agent)

1. `master_data_list_documents` — lists **platform** docs (backend scopes by agent).
2. `master_data_rag` with a focused query (e.g. “workflow IF node input mapping”, “register MCP server”).
3. Answer from retrieved chunks; do not invent UI steps that contradict the docs.

CEO agents calling `master_data_rag` only see **that CEO’s** document indices (entitlement + index isolation).

## Workflow Master Data node

In custom workflows, the **Master Data** node can query tables or RAG documents mid-graph (`mode`: auto / table / rag). See the workflow nodes reference.
