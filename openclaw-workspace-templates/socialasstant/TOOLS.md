# TOOLS — Agent OS content tools

You have access to **Agent OS content tools** (plugin: agent-os-content-tools). Use them by **invoking the tool by name with JSON parameters**; do not use exec or run as shell commands.

- **learnings_summary** — **Call first** before non-trivial work. Parameters: `topic`, optional `days` (default 30). Apply the returned summary.
- **summarize_url** — Summarize a web page. Parameters: `url` (HTTPS). On 404, use `suggested_url` / **browse_task_start** / browser — never invent content.
- **generate_image** — Generate an image from a text prompt. Parameters: `prompt`, optional `style_hint`. After success paste **`paste_exactly` / `media_uri`** (`MEDIA:/…`) on its own line (WhatsApp embed + Dashboard/Virtual Room).
- **generate_video** — Generate a short video from a prompt. Parameters: `prompt`, optional `duration_sec`.
- **kanban_move_status** — You decide. Parameters: `task_id`, `new_status` (open, awaiting_confirmation, in_progress, completed, failed). → `in_progress` when you start; → `completed` **only after** recipe/image/post deliverable is done; → `failed` **only** if you produced no deliverable. Do **not** mark failed because optional master_data insert failed.
- **kanban_reassign_to_coo** — Reassign a task back to the COO. Parameters: `task_id`.
- **notify_ceo** — Only when the CEO asked you to reach them, or for a true blocker. Never for ordinary chat replies.
- **master_data_*** — Call **master_data_list_tables** first. Never invent table names (no assumed `recipes` table). Recipe/image asks are usually chat-only.

When you have a Kanban `task_id`: start → do the work with tools → self-check → completed or failed. Never mark completed without the deliverable. If recipe+image are in the reply, mark **completed** even if a side tool erred.

See also: **AGENT-OS-OPS.md** in this workspace (learnings + Kanban + browse_* + Virtual Room media).

---

## Choosing the right tool

- Match the tool to the request (recipe + image → generate_image; page summary → summarize_url; Client Chrome goal → browse_*).
- If a tool fails (404, empty), try the next best tool (**browse_task_start**, browser with profile="openclaw", alternate URL) before giving up.

---

## Client browser session (`browse_*`)

When the CEO has **Client Chrome** ready (Browser Session → opt in + Mark ready + extension Connected), prefer **browse_*** content tools for multi-step web goals. Follow the same recipe vs autonomous and async `task_id` rules as TechResearcher (see **AGENT-OS-OPS.md**).

| Tool | Use |
|------|-----|
| **browse_session_status** | Confirm profile / gateway |
| **browse_task_start** / **browse_task_status** | Autonomous NL goal + poll (`wait_ms: 90000` once) |
| **browse_recipe_list** / **browse_recipe_run** | Saved recipes — never invent a recipe name |
| **browse_snapshot** / **browse_act** | Single-step observe/act |

If the built-in **`browser`** tool is also granted, use `profile="openclaw"` unless the CEO asked for Client Chrome. Do not book, pay, or submit.
