# TOOLS — Agent OS content tools

You have access to **Agent OS content tools** (plugin: agent-os-content-tools). Use them by **invoking the tool by name with JSON parameters**; do not use exec or run as shell commands.

- **learnings_summary** — **Call first** before non-trivial work. Parameters: `topic`, optional `days` (default 30).
- **summarize_url** — Summarize a web page. Parameters: `url` (HTTPS). On 404, use `suggested_url` / **browse_task_start** / browser.
- **generate_image** — Generate an image from a text prompt. Parameters: `prompt`, optional `style_hint`. Paste `![generated](<absolute_url>)` after success; for WhatsApp also put `media_uri` on its own line.
- **generate_video** — Generate a short video from a prompt. Parameters: `prompt`, optional `duration_sec`.
- **kanban_move_status** — You decide. Parameters: `task_id`, `new_status` (open, awaiting_confirmation, in_progress, completed, failed). → `in_progress` when you start; → `completed` only after the deliverable is done.
- **kanban_reassign_to_coo** — Reassign a task back to the COO. Parameters: `task_id`.

When you have a Kanban task_id: start → do the work → self-check → completed or failed. Never mark completed without doing the work.

See also: **AGENT-OS-OPS.md** in this workspace.

---

## Choosing the right tool

- **Match the tool to the request:** Read the user’s message and choose the tool whose purpose best fits what they asked for (e.g. rates → forex_rates, web summary → summarize_url, image → generate_image, Client Chrome → browse_*). Use each tool’s description to decide.
- **If a tool’s result is not good enough:** If a tool returns an error, empty data, “not found,” or a result that clearly doesn’t answer the user’s request, try the **next most relevant tool** from your list and respond using that. Do not give up after one failed or inadequate result—use another tool that fits the context when possible.

---

## Browser automation (OpenClaw + Playwright)

You have the **browser** tool for web automation (navigate, snapshot, click, type, screenshot).

- **Always use `profile="openclaw"`** — the managed Playwright/Chromium browser. Do **not** use `profile="chrome"` unless the user explicitly asks to attach their Chrome tab via the Browser Relay extension.
- Typical flow: `browser` action start (profile openclaw) → open URL → snapshot → act using refs from snapshot.
- If browser fails, report the error; do not ask the user to install the Chrome extension unless they requested chrome profile.

## Client browser session (`browse_*`)

When granted and Client Chrome is ready, prefer **browse_*** for Browser Session goals (recipe vs autonomous + async `task_id` — see **AGENT-OS-OPS.md** / TechResearcher TOOLS.md). Do not mix built-in `browser` and `browse_*` in the same turn.
