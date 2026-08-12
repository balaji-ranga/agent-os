# Master Data and document RAG

## Open Master Data (`/master-data`)

Two pillars:

1. **Tables** — structured rows/columns (CSV-friendly). Still stored in the CEO SQLite database.
2. **Documents** — uploaded files indexed in **OpenSearch** (not SQLite) for search and RAG.

## Tables

- New CEOs get a **departments** table (Executive, Research, Finance, Social, Engineering, Operations, Job Pipeline, …) with `name`, **`purpose`** and **`monthly_token_budget`** columns. Purpose is synced into agent workspaces via ORG.md — see [18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md).
- New CEOs also get an empty **`agent_workflow_notify_prefs`** table (`agent_id`, `workflow_id`, `enabled`) for optional agent→workflow wake allowlists — see [06-workflows-building.md](./06-workflows-building.md) / [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md). No rows for an agent = notify all; rows = only matching workflows. CEO bell is unchanged.
- Add columns and rows; import CSV when available.
- Capture a **purpose/description** on the table so agents know what it is for.
- Agents with Master Data tools can list tables, list/insert/update/delete **rows**. They generally **cannot** create/alter/drop tables from chat — that stays in the UI.
- Before insert/update, agents should call **`master_data_list_tables`** and use a real table name. They must **not** invent tables (e.g. do not assume a `recipes` table exists). Recipe/image asks are usually chat deliverables unless you asked to store a row.

Example asks: “list departments”, “add Engineering if missing”.

## company_memory (seed identity table)

After **Company setup** Apply (or from day one for new companies), Knowledge includes table **`company_memory`** with columns **`item`** / **`detail`**. Typical items: Mission, Organization DNA, DNA notes, Company, Industry type, Build around CEO. Operate Day 1 may append an operating-model stamp row.

Update those identity fields anytime via avatar → **Update Company Details** (`/update-company-details`, help **35**). That path **creates** the table if missing and upserts rows + strategic profile — it does not re-run full blueprint Apply.

## Documents and RAG (OpenSearch)

- Each CEO has **two isolated OpenSearch indices**:
  - `aos-docs-meta-{fingerprint}` — document meta (title, source, tags, storage path, excerpt)
  - `aos-docs-search-{fingerprint}` — chunk text for BM25 search (+ local Qwen k-NN embeddings)
- Platform help / README live in **`aos-docs-*-platform`** (admin-managed). They are **not** copied into each CEO index.
- File **bytes** stay on disk under `master-data/{owner}/docs/`; only meta + chunks are indexed in OpenSearch.
- Upload policies, handbooks, and guides as **PDF, Word (.docx), Excel (.xlsx/.xls), or text** (`.txt`, `.md`, `.csv`, …).
- Text is extracted on upload and indexed. Image-only PDFs and legacy `.doc` (not `.docx`) are not indexed well — convert or paste text.
- Use **Reindex** (or **Reindex all for RAG**) on Master Data so chunks are rebuilt from the stored files.
- Retrieval uses OpenSearch full-text (**BM25**) plus optional **k-NN vectors** from the **local Qwen** embedding container (`Qwen/Qwen3-Embedding-0.6B`, 1024-d). No OpenAI embedding API/key is used. If embeddings are disabled or the service is down, search falls back to BM25 only.
- UI may offer a RAG query box; agents use **`master_data_list_documents`** then **`master_data_rag`**. For the **agent tool**, prefer omitting `summarize` (defaults **false**) and answer from returned `chunks[]` yourself. The **Master Data UI** RAG box and the workflow **Master Data** node default to `summarize: true` (LLM answer).

### Index from chat / WhatsApp / channels

Chat and channel files land in the CEO workspace folder **`inbound/attachments/`** (browse them under **Master Data → Inbound attachments** or **Content Explorer** — [26-content-explorer.md](./26-content-explorer.md)).

| File type | What to do |
|-----------|------------|
| PDF, Word `.docx`, Excel, txt/md/csv/json/html/xml | CEO: **Index to RAG** in the Inbound panel, or ask COO — agents use **`list_inbound_attachments`** then **`master_data_index_document`** (indexes into **your** OpenSearch indices), then **`master_data_rag`**. |
| Image / audio / video | Stay in inbound only — **not** RAG-indexed. Images: **analyze_image**. Audio: **speech_stt**. |

Agents never spoof `owner_user_id`; indexing always targets the entitled CEO.

### Platform Help vs your uploads

| Who | Where | How to manage |
|-----|--------|----------------|
| CEO uploads | Your user OpenSearch indices | Master Data → Documents |
| Platform Help / User Guide | Platform OpenSearch indices | Admin → **Documents RAG** |
| Platform Help agent | Same platform indices (backend routes `platformhelp` automatically) | No AgentSystem config change |

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
