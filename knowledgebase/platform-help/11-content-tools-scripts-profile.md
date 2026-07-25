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
4. **`master_data_rag` without `summarize`** — `summarize` defaults to `false`, so agents get raw excerpts in `chunks[]` and write the answer themselves (no extra LLM cost). They only pass `summarize: true` when excerpts are too long or scattered to answer directly.
5. **`notify_ceo`** only when you asked to be reached / for true blockers / specialist “contact me” handoffs — not for ordinary live chat replies.

### LLM cost controls on summary tools

Three tools call an LLM to summarize history. All three cache the summary **once per UTC day per scope**, so repeated calls in the same day cost nothing extra when nothing new happened:

| Tool | Cache scope | Rebuilds when | Bypass |
|------|-------------|---------------|--------|
| `learnings_summary` | owner + agent | new UTC day **with new feedback** (incremental merge), or base older than `LEARNINGS_FULL_REBUILD_DAYS` (default 7) | `force: true` or `refresh: true` |
| `ibkr_order_learnings` | owner + `days` + `symbol_key` | **any new order event** (same day included — trading must not act on stale rejects), or base older than `ORDER_LEARNINGS_FULL_REBUILD_DAYS` (default 7) | `force: true` or `refresh: true` |
| `brain_history` | owner + `days` + workflow/node ids | **any new brain step**, or base older than `BRAIN_HISTORY_FULL_REBUILD_DAYS` (default 7) | `force: true` or `refresh: true` |

**Same-day, no new data:** if the watermark (newest feedback id / kanban timestamp / order id / brain step) is unchanged, a later call on the same UTC day returns the cached summary with `cache_mode: cache_hit` — **no LLM call**.

**New UTC day, no new data:** the cache extends `valid_date` to today and returns the existing summary with `cache_mode: no_new` — still **no LLM call**. This is the usual “same-day no rebuild” path extended across midnight when nothing changed.

**When data moves:** watermark change or stale base age triggers `cache_mode: rebuild` and a fresh (or incremental) LLM summary.

Responses carry `cached` and `cache_mode` (`rebuild` / `cache_hit` / `no_new` / `no_data`) so you can see whether a call spent tokens. `response_type=actual` never calls an LLM.

**Deploy tuning (optional):** in `deploy/.env` / backend env — `LEARNINGS_FULL_REBUILD_DAYS`, `ORDER_LEARNINGS_FULL_REBUILD_DAYS`, `BRAIN_HISTORY_FULL_REBUILD_DAYS` (each defaults to **7**). Lower values force full rebuilds more often; higher values allow longer incremental chains.

**SQLite tables (per CEO tenant DB where applicable):**

| Table | Used by |
|-------|---------|
| `agent_learnings_cache` | `learnings_summary` — one row per `(owner_user_id, agent_id)` |
| `tool_summary_cache` | `ibkr_order_learnings`, `brain_history` — one row per `(owner_user_id, kind, scope_key)` |

`master_data_rag` is deliberately **not** cached — its input is free-text, so a query-keyed cache would rarely hit. Instead it defaults to `summarize: false`, which removes the LLM call entirely from the common path. RAG retrieval moves to an embedding model next; caching will be revisited then.

On **`summarize_url` 404/403**, retry live reputable sources or **browser**, never invent page content; still deliver a brief and complete the card if the brief is substantive.

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
