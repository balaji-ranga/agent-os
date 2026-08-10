# TOOLS — Agent OS tools

When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or run as shell commands.

---

## Choosing the right tool

- **Match the tool to the request:** Read the user's message and choose the tool whose purpose best fits what they asked for (e.g. rates → forex_rates, web summary → summarize_url, image → generate_image, **run custom workflow** → agent_workflow_trigger, **send email or calendar invite** → email_send, **notify the CEO user** → notify_ceo, **org departments / master tables / documents** → master_data_list_tables then master_data_list_rows or master_data_rag). Use each tool's description to decide.
- **If a tool's result is not good enough:** If a tool returns an error, empty data, "not found," or a result that clearly doesn't answer the user's request, try the **next most relevant tool** from your list and respond using that. Do not give up after one failed or inadequate result—use another tool that fits the context when possible.

---

## Send email & calendar invites (email_send)

Use **email_send** when the CEO asks to send an email, send something **as email**, or include a **calendar/meeting invite**. This is the correct tool — **not** agent_workflow_trigger and **not** the browser tool.

| Field | Required | Notes |
|-------|----------|-------|
| `to` | yes | Recipient email(s) — string or array |
| `subject` | yes | Email subject |
| `body` | yes* | Plain-text only — **never** paste `BEGIN:VCALENDAR…` ICS markup here |
| `calendar` | for invites | `{ title, start, end, location?, description?, attendees? }` — ISO 8601; backend builds `.ics` attachment |

**Correct calendar invite example (copy this shape):**
```json
{
  "to": "guest@example.com",
  "subject": "Dinner invitation",
  "body": "You're invited to dinner. The calendar invite is attached.",
  "calendar": {
    "title": "Dinner",
    "start": "2026-08-01T21:00:00+08:00",
    "end": "2026-08-01T22:00:00+08:00",
    "description": "Agent demo"
  }
}
```

**Do NOT:**
- Put `BEGIN:VCALENDAR` / `END:VCALENDAR` text in `body` — use the `calendar` object instead
- Call **agent_workflow_enquire** / **agent_workflow_trigger** for one-off email or invite requests (workflows are for multi-step automation, e.g. job discovery pipelines)

---

## Master Data & RAG (owner-scoped)

Use these for **org master tables** (e.g. departments) and **document RAG**. Data is always this CEO's only. **Never** create/alter/drop tables via tools — schema is managed in the Master Data UI.

| Tool | When to use |
|------|-------------|
| **master_data_list_tables** | DISCOVERY only — tables + **purpose**. Then you **must** call list_rows on the purpose-matching table. Never answer with only the catalog. |
| **master_data_list_rows** | READ rows after purpose match (`table_name` / `table_id`). This is how you answer "what departments…". |
| **master_data_insert_row** | Insert `{ table_name, data:{…} }` into an existing table. |
| **master_data_update_row** | Update `{ table_name, row_id, data:{…} }`. |
| **master_data_delete_row** | Delete `{ table_name, row_id }` (row only — not the table). |
| **master_data_list_documents** | DISCOVERY for already-indexed docs (optional before RAG). |
| **list_inbound_attachments** | Find chat / WhatsApp / channel files under `inbound/attachments/` (`relative_path`, `download_url`, `paste_in_chat`, `rag_indexable`, `is_media`). |
| **master_data_index_document** | Index a **RAG-able** file into this CEO's OpenSearch docs (same as Master Data → Documents). Prefer `{ "relative_path": "inbound/attachments/…" }` from list_inbound. Or `content_base64` / `content_text` + `filename`. **Rejects** images/audio/video. |
| **master_data_rag** | Answer from **indexed document** content (`query` required). Omit `summarize` (defaults `false`) and answer from `chunks[]` yourself. |

**Chat / WhatsApp / channel attachments:**
1. **`list_inbound_attachments`** — see what landed in `inbound/attachments/` (match filename loosely).
2. **Re-attach / download in Dashboard chat:** paste the tool item's **`paste_in_chat`** markdown link in your reply (CEO must be logged in). Do **not** specialty-delegate find/download/attach.
3. If **PDF, Word (.docx), Excel, txt/md/csv/json/html/xml** and content Q&A → **`master_data_index_document`** `{ "relative_path": "…" }` then **`master_data_rag`**.
4. If **image / audio / video** → **do not index for RAG**. For **images**, call **analyze_image** with `{ "path": "inbound/attachments/…" }`. For **audio**, use **speech_stt**. CEO can also browse **Master Data → Inbound** or **Content Explorer**.

**Example — departments in this org:**
1. **master_data_list_tables** → find table whose purpose/name matches departments
2. **master_data_list_rows** `{ "table_name": "<that table>" }`
3. Reply with department names from **rows** (not the table list)

**Example — question about an uploaded document:**
1. Prefer **master_data_rag** `{ "query": "<user question>" }`
2. Or **master_data_list_documents** then rag with `document_id` if needed
3. If the file only exists in inbound and is not indexed yet → index first, then rag

Do **not** use the browser tool for Master Data.

---

## Notify CEO user (notify_ceo)

Use **notify_ceo** **only** when the CEO explicitly asked you to reach/notify/ping them, or for a true blocker/approval while they are **not** already in your Dashboard chat. Recipient is always the entitled CEO for this session; **never** pass `user_id` / `ceo_user_id`.

**Do NOT call notify_ceo** for ordinary chat replies, acknowledgements, or finished research/content — the CEO already sees your answer in chat.

**Always set `link_url` to your chat path** when you do notify: `/agents/<your-agent-id>/chat` (e.g. `/agents/socialasstant/chat`).

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Short notification title |
| `body` | no | Message text |
| `link_url` | strongly recommended | `/agents/<your-id>/chat` so the bell opens your chat |
| `source_key` | no | Idempotency key to avoid duplicates |

**Example (only after CEO asked you to reach them):**
```json
{
  "title": "SocialAssistant ready",
  "body": "Happy to discuss your social media plan.",
  "link_url": "/agents/socialasstant/chat"
}
```

**COO only:** If the CEO asks you to have *another* agent reach them, do **not** call notify_ceo yourself — **sessions_send** to that agent and instruct them to call notify_ceo.

---

## Speech (free Whisper STT + Piper TTS)

Use these Agent OS content tools (not ElevenLabs) when the CEO asks you to speak or transcribe:

| Tool | When |
|------|------|
| **speech_tts** | Synthesize speech: `{ "text": "Hello from BalServe" }` → returns `url` / media artifact |
| **speech_stt** | Transcribe: `{ "artifact_id": "<id>" }` from a prior TTS/upload, or `{ "content_base64": "..." }` |
| **analyze_image** | Describe / OCR / review an inbound image: `{ "path": "inbound/attachments/….jpg", "mode": "review" }` |

Requires platform `optional-voice` (whisper + piper) for speech. **analyze_image** uses platform primary LLM (or BYOK `Platform_BYOK`). If the tool returns 503 / upstream vision error, the configured model may be text-only.

---

## Watch a Kanban task + notify when done (COO cron)

When the CEO asks you to **check back / notify when a Kanban task finishes** (especially via WhatsApp):

1. Confirm the numeric **task_id** (e.g. `#4126`). Use **kanban_get_task** once to validate it exists.
2. Create an OpenClaw **cron** job with:
   - schedule **every 5 minutes** (or what they asked)
   - **timeoutSeconds ≥ 180** (60s is too short and causes failure spam)
   - delivery **announce** to their WhatsApp (or the channel they asked for)
   - **name** must include `#<task_id>` (e.g. `Watch Kanban #4126 Platform Help`)
   - payload message must instruct the cron turn to:
     - call **kanban_watch_tick** with `{ "task_id": <id> }` (and `cron_job_id` if you already know it)
     - reply with **exactly** the tool's `reply` field (`NO_REPLY` while pending, or `notify_text` when done)
     - call **no other tools**
3. Tell the CEO the cron is running and that it **auto-stops** when the task is `completed` or `failed` (kanban_watch_tick removes matching crons).

**Do not** keep announcing cron *failures* as status updates — if a watch cron errors, fix timeout/message or remove it; do not leave a broken announce job running.

### Read Kanban task content (COO)

When the CEO asks **what a task produced**, **what the specialist wrote**, or to **summarize a completed/failed card**:

1. Call **kanban_get_task** `{ "task_id": <id> }`.
2. Answer from (in order): **`deliverable`** → **`delegation_response`** → **`chat_context.turns`** (assistant replies) → **`messages`**. Include title/status only as framing.
3. Do **not** invent content from the title alone. If `deliverable` and chat turns are empty, say the card has no stored deliverable yet.

| Tool | When |
|------|------|
| **kanban_get_task** | Status **and full content** for a task_id (description, deliverable, messages, chat turns) |
| **kanban_watch_tick** | Inside the watch cron only — returns `reply` + stops the cron when done |

---

## Scheduled goals (recurring CEO prompts)

Use these when the CEO wants work **every hour / every day / weekdays / weekly / always** without building a workflow graph.

| Tool | When |
|------|------|
| **scheduled_goal_create** | Create: `prompt` (required), optional `title`, `agent_id` (default coo), `cadence` hourly\|daily\|weekdays\|weekly, `time_local` HH:MM (for **hourly** only the minutes `:MM` are used — fires once each hour at that minute), `ends_at` YYYY-MM-DD or omit for perpetual |
| **scheduled_goal_list** | List all schedules for this CEO |
| **scheduled_goal_update** | **Edit**: change prompt/time/agent/cadence; `status: "paused"` or `"active"` (pause removes from clock; persists after restart) |
| **scheduled_goal_delete** | Permanent remove from schedule |
| **scheduled_goal_run_now** | Fire immediately |

Confirm in plain English after create/update/pause/delete. Tell the CEO they can also open **Scheduled goals** in the menu to edit.

---

## Custom agent workflows (Workflows UI)

These tools let the CEO run published workflows from chat. They are **not** the legacy Job Applicant pipeline (`job_run_workflow_now`).

| Tool | When to use |
|------|-------------|
| **agent_workflow_enquire** | CEO describes a workflow loosely ("the MCP test one", "brain approval"). Pass `query` with their description, or `all: true` to return every published workflow. Returns `id`, `trigger_modes`, `chat_trigger_phrase`, and `trigger_hint`. |
| **agent_workflow_list** | List **all** published workflows (manual, schedule, webhook, and chat). Pass `chat_only: true` to limit to chat-phrase triggers only. |
| **agent_workflow_trigger** | Start a run (returns immediately with `async:true` + `run_id`). Pass `message` with the exact chat phrase (e.g. `run erp maker checker`) **or** `workflow_id`. Optional `input` for run payload. **Never block the chat turn** waiting for the run to finish. |
| **agent_workflow_runs** | List or inspect **recent run statuses/outcomes** when the CEO **asks later**. Pass `workflow_id` or `workflow_query`/`query` to scope one workflow; omit for recent runs across workflows; pass `run_id` to inspect one run. **Never** use `ibkr_order_learnings` for this. |
| **agent_workflow_watch** | Optional re-register notify-on-CEO-wait / notify-on-terminal for an existing `run_id` (auto after trigger). |
| **agent_workflow_watch_tick** | Optional COO cron poll (like `kanban_watch_tick`): `NO_REPLY` while running; text when waiting for CEO or terminal. Prefer platform auto-notify. |

**Typical flow:** CEO asks to run something → **agent_workflow_enquire** if needed → **agent_workflow_trigger** → reply with `run_id` and **stop**. Platform notifies on CEO approval wait and terminal. Later status → **agent_workflow_runs** only if asked.

**Maker/Checker HITL:** Prefer phrases `run erp maker checker` / `run crm maker checker`. Makers must signal `{"decision":"needs_ceo",...}` for policy gates (e.g. 5% discount); the workflow opens a **CEO Approval** Kanban node. Do not invent free-form CEO Kanban “comment Approved” cards — they do not resume runs.

Do **not** use exec, shell, or `job_run_workflow_now` for custom agent workflows.

---

## Browser automation (OpenClaw + Playwright)

You have the **browser** tool for web automation (navigate, snapshot, click, type, screenshot).

- **Always use `profile="openclaw"`** — the managed Playwright/Chromium browser. Do **not** use `profile="chrome"` unless the user explicitly asks to attach their Chrome tab via the Browser Relay extension.
- Typical flow: `browser` action start (profile openclaw) → open URL → snapshot → act using refs from snapshot.
- If browser fails, report the error; do not ask the user to install the Chrome extension unless they requested chrome profile.

## Client browser session (`browse_*`)

When the CEO has **Browser Session / Client Chrome** ready and you are granted **browse_*** tools, prefer them for multi-step Client Chrome goals (same recipe vs autonomous + async `task_id` pattern as TechResearcher — see **AGENT-OS-OPS.md**). Do not use built-in `browser` and `browse_*` in the same turn.
