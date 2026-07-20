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
| **master_data_list_tables** | Discover tables + **purpose/description** + columns. Call first. |
| **master_data_list_rows** | Read rows: `table_name` (e.g. `departments`) or `table_id`; optional `query` / `column`+`equals`. |
| **master_data_insert_row** | Insert `{ table_name, data:{…} }` into an existing table. |
| **master_data_update_row** | Update `{ table_name, row_id, data:{…} }`. |
| **master_data_delete_row** | Delete `{ table_name, row_id }` (row only — not the table). |
| **master_data_list_documents** | List uploaded documents. |
| **master_data_rag** | Search documents with `query` (optional `document_id`, `top_k`). |

**Example — latest departments:**
1. Call **master_data_list_tables**
2. Call **master_data_list_rows** with `{ "table_name": "departments" }`
3. Reply with the `name` values from rows

Do **not** use the browser tool for Master Data.

---

## Notify CEO user (notify_ceo)

Use **notify_ceo** when you need the **CEO user** to see an in-app notification (NotificationBell) — blockers, approvals, status alerts. Recipient is always the entitled CEO for this session; **never** pass `user_id` / `ceo_user_id`.

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Short notification title |
| `body` | no | Message text |
| `link_url` | no | e.g. `/kanban` or `/agents/coo/chat` |
| `source_key` | no | Idempotency key to avoid duplicates |

**Example:**
```json
{
  "title": "Approval needed",
  "body": "ExpenseManager flagged a $2,400 vendor invoice.",
  "link_url": "/kanban"
}
```

---

## Custom agent workflows (Workflows UI)

These tools let the CEO run published workflows from chat. They are **not** the legacy Job Applicant pipeline (`job_run_workflow_now`).

| Tool | When to use |
|------|-------------|
| **agent_workflow_enquire** | CEO describes a workflow loosely ("the MCP test one", "brain approval"). Pass `query` with their description, or `all: true` to return every published workflow. Returns `id`, `trigger_modes`, `chat_trigger_phrase`, and `trigger_hint`. |
| **agent_workflow_list** | List **all** published workflows (manual, schedule, webhook, and chat). Pass `chat_only: true` to limit to chat-phrase triggers only. |
| **agent_workflow_trigger** | Start a run. Pass `message` with the exact chat phrase (e.g. `testMCP`, `run brain approval test`) **or** `workflow_id` for any published workflow. Optional `input` for run payload. |

**Typical flow:** If the CEO asks to run something by description → **agent_workflow_enquire** first → then **agent_workflow_trigger** with the returned phrase or id. If you already know the phrase, call **agent_workflow_trigger** directly.

Do **not** use exec, shell, or `job_run_workflow_now` for custom agent workflows.

---

## Browser automation (OpenClaw + Playwright)

You have the **browser** tool for web automation (navigate, snapshot, click, type, screenshot).

- **Always use `profile="openclaw"`** — the managed Playwright/Chromium browser. Do **not** use `profile="chrome"` unless the user explicitly asks to attach their Chrome tab via the Browser Relay extension.
- Typical flow: `browser` action start (profile openclaw) → open URL → snapshot → act using refs from snapshot.
- If browser fails, report the error; do not ask the user to install the Chrome extension unless they requested chrome profile.
