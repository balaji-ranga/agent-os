# Tools, custom scripts, AI Snipper, Profile

## Tools (`/content-tools`)

Catalog of Agent OS tools agents and workflows can call, for example:

- `summarize_url`, `generate_image`, `generate_video`, `speech_tts` — return `paste_exactly` / `media_uri` (`MEDIA:/abs/path` for **WhatsApp file attach**) and auth-only `/api/media/…` for **Dashboard chat** (inline image/audio/video players with your login). Media is **not** world-public. Optional legacy signed URLs require ops `MEDIA_PUBLIC_SIGNED=1` (off by default).
- **WhatsApp TTS tip:** prefer OGG/Opus (or MP3) from `speech_tts`; WAV often fails WhatsApp attach. Dashboard still plays WAV inline.
- **Platform feedback:** `platform_feedback_submit` / `platform_feedback_enquire` (COO / Platform Help) — file bugs, feedback, or enhancements; Admins triage at **Platform feedback** (`/admin/platform-feedback`).
- **Chat / channel attachments:** Web paperclip and WhatsApp inbound media land under **`inbound/attachments/`** (plus Master Data for web uploads). Summarize or transcribe with `speech_stt` / inbound-media workflow using the relative path or `MEDIA:` line.
- Kanban helpers (`kanban_create_task`, `kanban_move_status`, **`kanban_get_task`** (full content / deliverable), `kanban_watch_tick`, …)
- `intent_classify_and_delegate`
- Workflow tools (`agent_workflow_list` / enquire / trigger / runs / **retry** / mutate / get_draft)
- `email_send`, `notify_ceo`
- **COO ops explain:** `this_week_digest` (Digest hours/$ methodology), **`operational_effectiveness`** (Home OEI 0–100 domains + KPIs; [36](./36-operational-effectiveness.md))
- Master Data (`master_data_list_tables`, row CRUD, `master_data_list_documents`, `master_data_rag`)
- `learnings_summary`, `brain_history`, `content_tools_enquire`
- **Browser Session:** `browse_session_status`, `browse_task_start`, `browse_task_status`, `browse_snapshot`, `browse_act`, `browse_recipe_list`, `browse_recipe_run` (see [22-browser-session-and-recipes](./22-browser-session-and-recipes.md)); specialists should use these — not the native `browser` tool in chat

### CEO actions

1. Browse tools (name, purpose).
2. **Test invoke** with JSON args; inspect **logs**.
3. Grant tools per agent under **Workspace → Tools access**.
4. In workflows, use a **Content Tool** node with the **exact** `toolName`.
5. Optionally set **Tools → Model** (per-tool model overrides) — see below.

Workflow Builder can recommend tools via `content_tools_enquire`.

### Tools → Model mapping

On **Tools**, open **Tools → Model**. Map a **chat / vision / image / video model** per BYOK-aware tool for **your** login only.

| What it does | Detail |
|--------------|--------|
| **Overrides** | When set, that tool uses your chosen model instead of Profile primary (or platform primary when Profile is Platform default) |
| **Does not change** | API keys and base URL — still Profile platform vs BYOK vault (`Platform_BYOK`, `Replicate_BYOK`, …) |
| **Profile default** | Empty mapping = keep using Profile primary / tool env defaults |
| **Included** | e.g. `summarize_url`, `analyze_image`, `generate_image`, `generate_video`, `learnings_summary`, `brain_history`, `master_data_rag` (**LLM summarize only**), intent/classify, browser autonomous task, IBKR order learnings, selected job-applicant LLM steps, workflow certify Maker/Checker chat |
| **Excluded** | Custom-script LLM review (platform-only), master-data **embeddings** indexing, local `speech_tts` / `speech_stt` (Whisper/Piper — not chat models) |

Save applies immediately for later tool runs (no gateway restart). Image models (e.g. `gpt-image-1`) and video (Replicate model/version id) use **Custom…** when not in the chat model list.

APIs (CEO/admin session, owner-scoped): `GET/PUT /api/tools/model-mappings`.

### Shared specialist ops (AGENT-OS-OPS)

All specialists share platform rules in workspace **`AGENT-OS-OPS.md`** (also summarized in TOOLS.md). Expect agents to:

1. **`learnings_summary`** once at the start of non-trivial work and apply past CEO likes/rejects — skip for one-word greets. **Chat thumbs-down comments are required** and treated as hard rules (including browser recipe vs autonomous mistakes). **Feedback lookback window = 30 days by default** (the `days` parameter; valid range 1–365). This 30-day window is what decides *how far back feedback is read* — do **not** confuse it with the 7-day cache rebuild cadence below (`LEARNINGS_FULL_REBUILD_DAYS`), which only controls how often the cached summary is fully regenerated.
2. **Own Kanban status** — `completed` only after a real deliverable; do not mark `failed` just because an optional Master Data insert/notify/email step failed.
3. **`master_data_list_tables` before insert** — never invent table names.
4. **`master_data_rag` without `summarize`** — for the **agent tool**, `summarize` defaults to `false`, so agents get raw excerpts in `chunks[]` and write the answer themselves (no extra LLM cost). They only pass `summarize: true` when excerpts are too long or scattered to answer directly. (The Master Data UI RAG box and the workflow **Master Data** node default to `summarize: true` — different path, different default.)
5. **`notify_ceo`** only when you asked to be reached / for true blockers / specialist “contact me” handoffs — not for ordinary live chat replies.

### LLM cost controls on summary tools

> **Two different "days" — do not conflate:**
>
> - **Lookback window** (the `days` parameter): how far back feedback / history is *read*. Per tool:
>   - `learnings_summary` — default **30** days (range 1–365).
>   - `brain_history` — default **7** days (range 1–90).
>   - `ibkr_order_learnings` — default **7** days (max 30, the order-event retention window).
> - **Full-rebuild cadence** (`*_FULL_REBUILD_DAYS`, default **7** for all three): how old the cached base may get before it is fully regenerated instead of incrementally merged. This is a caching knob, **not** the lookback window — even when both numbers happen to be 7.
>
> If asked "how many days of feedback does the learnings summary use?", the answer is **30 days**.

Three tools call an LLM to summarize history. All three cache the summary **once per UTC day per scope**, so repeated calls in the same day cost nothing extra when nothing new happened:

| Tool | Lookback default | Cache scope | Rebuilds when | Bypass |
|------|------------------|-------------|---------------|--------|
| `learnings_summary` | **30 days** (1–365) | owner + agent | new UTC day **with new feedback** (incremental merge), or base older than `LEARNINGS_FULL_REBUILD_DAYS` (default 7) | `force: true` or `refresh: true` |
| `ibkr_order_learnings` | **7 days** (max 30) | owner + `days` + `symbol_key` | **any new order event** (same day included — trading must not act on stale rejects), or base older than `ORDER_LEARNINGS_FULL_REBUILD_DAYS` (default 7) | `force: true` or `refresh: true` |
| `brain_history` | **7 days** (1–90) | owner + `days` + workflow/node ids | **any new brain step**, or base older than `BRAIN_HISTORY_FULL_REBUILD_DAYS` (default 7) | `force: true` or `refresh: true` |

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

`master_data_rag` is deliberately **not** cached — its input is free-text, so a query-keyed cache would rarely hit. Instead the **agent tool** defaults to `summarize: false`, which removes the LLM call entirely from the common path (the Master Data UI box and workflow Master Data node default to `summarize: true`). RAG retrieval moves to an embedding model next; caching will be revisited then.

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

Ops dashboard next to AI Snipper, with three tabs: **Org**, **Department**, and **Agent View**.

### Org tab

| Metric | Meaning |
|--------|---------|
| Agents | Enabled agents on your account |
| Tasks automated | Kanban tasks assigned to agents in the range |
| Tasks ok / failed | Completed vs failed outcomes |
| Feedback positive % | Thumbs-up share of ratings |
| AI workflows | Definitions you own (incl. published count) |
| Successful / failed / total runs | Workflow run outcomes |
| Storage (MB) | Estimated data for **your** tenant: chats, standup messages, workflow payloads, Master Data document files, **OpenSearch Master Data RAG indices** (meta + search/vectors), Content Explorer media, avatars/VR, CEO SQLite, OpenClaw tenant workspace. Click the **i** icon for a line-item breakdown. |

**Time switch:** last 7 / 14 / 30 / 90 days, or **All** (the "1 month" and "3 months" buttons mean rolling **30** and **90** days, not calendar months). Charts: Tasks, Feedback, Workflow runs. Storage is a point-in-time estimate (not range-filtered).

### Department tab

Month-to-date tokens used by every member of each department, against the department's
`monthly_token_budget` from Master Data → `departments`. Badges read **Within / Near / Over
department budget** (or **No department budget** when the column is blank). Department budgets are
planning figures only — blocking happens per agent, not per department. Deep-link with
`/efficiency?tab=department`.

### Agent View tab

Pick one member — internal agent **or** external/A2A leaf member — to see its prompts, tool calls,
tasks ok/failed, feedback, average delegation latency, **tokens used vs monthly budget**, and
**failure rate vs error budget**, plus Activity / Outcomes / Token budget / Reliability charts and
top tools. **Edit budget** sets the monthly token allowance and error budget %. **Reset usage**
(selected member) and **Reset all usage** zero month-to-date tokens without touching the budget —
use them to unblock an agent that hit its cap. External / A2A leaf members show **n/a** for
prompts, tool calls, and feedback because those are only recorded for internal agents.

Budgets warn at 80% and **block** new chat/delegated work at 100% tokens (or at the error budget
after at least 10 terminal calls). See
[18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md).

## Profile (`/profile`)

Name, email, region, mobile, password, MFA, **model provider + chat model**, and **data persistence** (30 / 60 / 90 / 120 / 365 days; **default 90** when you have never changed it).

- After the retention window, agent chat turns, standup **messages**, workflow run/step records, and aged **Content Explorer** uploaded/generated media are permanently deleted from disk (daily job; purge also available on Profile and Dashboard). Standup records themselves, Kanban cards, Master Data and API keys are never purged by retention. Job schedules: [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md).
- OpenAI / OpenRouter need vault key **`Platform_BYOK`** under **API Keys**, then a **chat model** on Profile — see [15-api-keys-vault.md](./15-api-keys-vault.md). Non-platform Profiles auto-seed that slot (plus Replicate / Brave / ElevenLabs) as **unset**.
- Profile model is the default for OpenClaw agent chat and for content tools that call the LLM. To override **only** specific tools, use **Tools → Model** on `/content-tools` (see above).
- Prefer **Settings → API Keys** for all long-lived secrets (never shown in platform access logs).
- Browse files: [26-content-explorer.md](./26-content-explorer.md).
## How agents learn company knowledge

| Layer | What |
|-------|------|
| Workspace MD | SOUL / AGENTS / TOOLS / MEMORY / ORG / **AGENT-OS-OPS** always in agent context |
| Master Data RAG | Uploaded docs (including Platform Help) via `master_data_rag` |
| Skills | Shared OpenClaw skills (content-tools, agent-send) |
| Learnings | `learnings_summary` over past CEO feedback / Kanban decisions (required before non-trivial specialist work) |

Platform Help agent: short workspace instructions + RAG over these help documents (recommended). Do not dump the full help tree into SOUL.
