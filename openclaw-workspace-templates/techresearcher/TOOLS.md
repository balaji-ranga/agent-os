# TOOLS — Agent OS content tools

You have access to **Agent OS content tools** (plugin: agent-os-content-tools). Use them by **invoking the tool by name with JSON parameters**; do not use exec or run as shell commands.

- **learnings_summary** — **Call first** before non-trivial work. Parameters: `topic` (short description), optional `days` (default 30). Apply the returned summary.
- **summarize_url** — Summarize a web page. Parameters: `url` (HTTPS). On 404, use `suggested_url` / a current page / **browser** — never invent content.
- **generate_image** — Generate an image from a text prompt. Parameters: `prompt`, optional `style_hint`. Paste `![image](<url>)` after success.
- **generate_video** — Generate a short video from a prompt. Parameters: `prompt`, optional `duration_sec`.
- **kanban_move_status** — You decide. Parameters: `task_id`, `new_status` (`open` | `awaiting_confirmation` | `in_progress` | `completed` | `failed`). → `in_progress` when you start; → `completed` **only after** the deliverable is done; → `failed` **only** if you produced no usable brief. After summarize_url 404/403, try ≥3 domains (wikipedia, bbc, reuters, *.gov.in) or browser — still deliver a brief with gaps noted, then complete.
- **kanban_reassign_to_coo** — Reassign a task back to the COO. Parameters: `task_id`.
- **notify_ceo** — Push an in-app notification to the CEO (NotificationBell). Parameters: `title` (required), optional `body`, `link_url`, `source_key`. Recipient is always the entitled CEO for this session — **never** pass `user_id` / `ceo_user_id`. Use **only** when the CEO asks you to reach them, or for a true blocker while they are not already in Dashboard chat. Do **not** notify for ordinary chat replies or finished research — they already see your answer.

When you have a Kanban `task_id`: `in_progress` → do the work with tools → self-check → `completed` or `failed`. Do not mark completed without the research/deliverable. Do not mark failed after delivering a substantive brief just because some URLs 404'd.

See also: `openclaw-workspace-templates/_shared/AGENT-OS-OPS.md` (same rules for all agents).

---

## Choosing the right tool

- **Match the tool to the request:** Read the user’s message and choose the tool whose purpose best fits what they asked for (e.g. web summary → summarize_url, image → generate_image, **reach/notify the CEO** → notify_ceo). Use each tool’s description to decide.
- **If a tool’s result is not good enough:** If a tool returns an error, empty data, “not found,” or a result that clearly doesn’t answer the user’s request, try the **next most relevant tool** from your list and respond using that. Do not give up after one failed or inadequate result—use another tool that fits the context when possible.
---

## Notify CEO user (notify_ceo)

Use **notify_ceo** **only** when the CEO asks you to reach them, or for a true blocker while they are not already chatting with you. Do **not** use it for ordinary research answers or status updates in Dashboard chat.

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Short notification title |
| `body` | no | Message text |
| `link_url` | no | e.g. `/agents/techresearcher/chat` or `/kanban` |
| `source_key` | no | Idempotency key to avoid duplicates |

**Example (only after CEO asked you to reach them):**
```json
{
  "title": "TechResearcher — ready to chat",
  "body": "I specialize in tech research. Happy to discuss your use case.",
  "link_url": "/agents/techresearcher/chat"
}
```

---

## Browser automation (OpenClaw + Playwright)

You have the **browser** tool for web automation (navigate, snapshot, click, type, screenshot).

- **Always use `profile="openclaw"`** — the managed Playwright/Chromium browser. Do **not** use `profile="chrome"` unless the user explicitly asks to attach their Chrome tab via the Browser Relay extension.
- Typical flow: `browser` action start (profile openclaw) → open URL → snapshot → act using refs from snapshot.
- If browser fails, report the error; do not ask the user to install the Chrome extension unless they requested chrome profile.
