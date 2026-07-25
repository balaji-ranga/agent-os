/**
 * Shared operating rules for all Agent OS specialists (copy into TOOLS.md / AGENTS.md).
 * Keep learnings + Kanban self-assessment consistent across agents.
 */

# Agent OS — shared operating rules

## Learnings (required before non-trivial work)

1. Call **learnings_summary** once at the start with `{ "topic": "<short description of the ask>", "days": 30 }`.
2. Read the returned `summary` and apply it (avoid past rejects; prefer what the CEO liked).
3. Do this for research, recipes, builds, multi-step Kanban work — not for one-word greets.

## Kanban — agent decides; only move when the work is real

You own card status. Mark **`completed` only after your reply contains the deliverable**.

The platform **rejects status-only completions**: if your reply is just “task marked as completed” (no answer body), the card stays **`in_progress`** and the same ask is **auto-retried once** (no CEO nudge required). After the retry cap, the card stays in progress for the CEO/COO status report.

| When | Action |
|------|--------|
| You start assigned work (have `task_id`) | `kanban_move_status` → `in_progress` |
| You need CEO clarification | → `awaiting_confirmation` |
| You **actually finished** the deliverable **in this reply** | → `completed` |
| You cannot finish | → `failed` or reassign to COO |

**Self-check before `completed` (all must be true):**
1. You did the requested work (research written, factual answer given, recipe+image produced, etc.) — not just acknowledged the ask.
2. You used tools when needed (`master_data_rag`, `summarize_url`, `browser`, `generate_image`, …) and incorporated results.
3. If a tool 404'd / failed, you tried alternates (≥3 domains or browser) and still produced a usable deliverable with gaps noted — **do not** mark completed with empty work.
4. Your reply contains the deliverable (or a clear blocker), not only status chatter.

**Use `failed` only when** you could not produce the main deliverable at all (no research brief, no recipe/image, etc.). Do **not** mark `failed` because an optional side step failed (e.g. `master_data_insert_row` into a non-existent table, notify, email). If the CEO got the recipe+image or research brief in chat, move to **`completed`**.

Dashboard chat: do **not** create Kanban unless the CEO asked to track it. If you created one, the same self-check applies. Trivial greets (`hi`, model questions) → answer immediately; do not invent recipes/images from prior session context.

Platform product how-to (RAG, workflows, MCP, nav): prefer **Platform Help** / `master_data_rag` over guessing — do not invent Flolah architecture.

## summarize_url failures

If **summarize_url** returns 404 / 403 / upstream error:
1. Prefer live pages: `en.wikipedia.org`, `bbc.com`, `reuters.com`, relevant `*.gov.in` (e.g. MeitY, NITI Aayog), major newspapers with current article URLs.
2. Or use **browser** (`profile="openclaw"`) on a search/results page, then summarize a working article URL.
3. Never invent page content. After retries, still deliver a concise brief and cite what worked vs what failed — then `completed` if the brief is substantive.

## Master Data

Call **master_data_list_tables** before insert/update. Never invent table names (e.g. do not assume a `recipes` table exists). Recipe/image asks are usually chat deliverables — skip Master Data unless the CEO asked to store a row.

## master_data_rag — read the excerpts yourself

For questions about uploaded documents (PDFs, policies, handbooks, resumes, help docs), call **master_data_rag** with `{ "query": "<the user's question in keywords>" }`.

**`summarize` defaults to `false`. Leave it out.** You get the matching excerpts in `chunks[]` and you write the answer — that is your job, and it costs the CEO nothing extra.

| Situation | What to pass |
|-----------|--------------|
| Normal document question | `{ "query": "..." }` — omit `summarize`, read `chunks[]`, answer in your own words |
| Narrow to one file (e.g. `[chat_attachments]` gave you a `document_id`) | add `"document_id": "mdd-…"` |
| Need more/fewer excerpts | add `"top_k": 3–10` (default 5) |
| Excerpts are too many/long/scattered to answer directly | add `"summarize": true` — **only then** |

**Rules:**
1. Do **not** pass `summarize: true` out of habit — it spends an extra LLM call per request. Default to reading `chunks[]`.
2. Answer **only** from the returned excerpts. Never invent document content. Cite the document title/filename.
3. If `hit_count` is 0 or the excerpts don't cover the ask, say so and offer `master_data_list_documents` to check what is uploaded — do not guess.
4. Use `master_data_rag` for **document** content only. Structured org tables → `master_data_list_tables` → `master_data_list_rows`. Never use `browser` for Master Data.

## notify_ceo — when to ring the CEO's bell

Use **notify_ceo** so the CEO sees an in-app notification (bell). Recipient is always this org's CEO — never pass a user id.

**Do call notify_ceo when:**
1. The CEO explicitly asked you to **reach / notify / ping / contact / get back to** them (including after async work: "notify me when done").
2. A true **blocker** while they are **not** already in Dashboard chat with you (need their attention elsewhere).
3. You are the **specialist** the CEO (or COO) asked to reach them — call notify with `link_url` = `/agents/<your-agent-id>/chat` so the bell opens **your** chat.

**Do NOT call notify_ceo when:**
1. Ordinary Dashboard chat replies — they already see your answer; notifying is noise.
2. You finished a normal research/recipe answer in the same chat thread (no explicit "notify me").
3. You are the **COO** and the CEO asked another specialist to reach them — **sessions_send** (or platform hard-path) to that specialist so **they** call notify_ceo. Do not notify as COO yourself.
4. Spam / duplicates — one clear notify per ask; do not re-notify every status tweak.

**Parameters:** `title` (required), optional `body`, `link_url` (prefer `/agents/<your-id>/chat`).

**Kanban vs notify:** Creating a Kanban card may also raise a platform bell. Status moves do not replace **notify_ceo** when the CEO asked to be reached.

## CEO profile — identity & contact (required)

When the ask needs the CEO's **name, email, phone/mobile, region, business name, industry**, or similar account attributes:

1. Call **ceo_profile** first (optional `fields: ["email","name",…]`). Never invent these from chat memory or past emails.
2. Use `profile.*` from the tool result as the source of truth for this org's logged-in CEO.
3. If the needed field is in `missing_or_empty` (blank on the account), **ask the CEO** or fall back to chat/session memory **only as a last resort** — and say clearly that the profile field was empty so you used chat memory.
4. Do **not** treat a past `email_send` destination (e.g. a Gmail used once for demos) as "the CEO's email" when `ceo_profile.email` is set.

`ORG.md` may also list the CEO email — still prefer **ceo_profile** so you get the live account values.

