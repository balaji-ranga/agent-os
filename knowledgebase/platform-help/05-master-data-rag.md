# Master Data and document RAG

## Open Master Data (`/master-data`)

Two pillars:

1. **Tables** — structured rows/columns (CSV-friendly).
2. **Documents** — uploaded files agents search with keyword RAG.

## Tables

- New CEOs get a **departments** table (Executive, Research, Finance, Social, Engineering, Operations, Job Pipeline, …) with `name`, **`purpose`** and **`monthly_token_budget`** columns. Purpose is synced into agent workspaces via ORG.md — see [18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md).
- Add columns and rows; import CSV when available.
- Capture a **purpose/description** on the table so agents know what it is for.
- Agents with Master Data tools can list tables, list/insert/update/delete **rows**. They generally **cannot** create/alter/drop tables from chat — that stays in the UI.
- Before insert/update, agents should call **`master_data_list_tables`** and use a real table name. They must **not** invent tables (e.g. do not assume a `recipes` table exists). Recipe/image asks are usually chat deliverables unless you asked to store a row.

Example asks: “list departments”, “add Engineering if missing”.

## Documents and RAG

- Upload policies, handbooks, and guides as **PDF, Word (.docx), Excel (.xlsx/.xls), or text** (`.txt`, `.md`, `.csv`, …).
- Text is extracted on upload and stored as keyword-searchable chunks. Image-only PDFs and legacy `.doc` (not `.docx`) are not indexed well — convert or paste text.
- If you uploaded office files before this support existed, use **Reindex** (or **Reindex all for RAG**) on Master Data so chunks are rebuilt from the stored files.
- New accounts include **Flolah Platform Help** documents (and often a short User Guide) so agents can answer “how do I use Flolah?”.
- RAG is **keyword chunk search** over SQLite chunks (not vector embeddings). Clear headings and repeated keywords improve hits.
- UI may offer a RAG query box; agents use **`master_data_list_documents`** then **`master_data_rag`**. Prefer omitting `summarize` (defaults **false**) and answer from returned `chunks[]` yourself.

### Purge uploads vs protected help docs

| Action | What happens |
|--------|----------------|
| **Delete** on one of your uploads | Removes that document from Master Data **and** disk. |
| **Purge all uploads** | Removes **all** of your uploaded documents (DB + disk) in one step. Confirm carefully — it cannot be undone. |
| Platform Help (`Flolah Help — …`) / **Flolah User Guide** | Marked **protected**. No Delete button; purge skips them. API returns `403` / `PROTECTED_DOCUMENT` if someone tries to delete them. Startup/register re-seeds them if missing. |

Protected docs are identified by title/filename conventions (User Guide / `README.md`, `Flolah Help —…` / `platform-help-*.md`), not by inventing a special owner.

### Agent pattern for help questions

1. `master_data_list_documents` — confirm Platform Help docs exist.
2. `master_data_rag` with a focused query (e.g. “workflow IF node input mapping”, “register MCP server”).
3. Answer from retrieved chunks; do not invent UI steps that contradict the docs.

## Workflow Master Data node

In custom workflows, the **Master Data** node can query tables or RAG documents mid-graph (`mode`: auto / table / rag). See the workflow nodes reference.
