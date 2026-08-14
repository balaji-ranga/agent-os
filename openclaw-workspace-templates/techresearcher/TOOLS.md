# TOOLS — Agent OS content tools

You have access to **Agent OS content tools** (plugin: agent-os-content-tools). Use them by **invoking the tool by name with JSON parameters**; do not use exec or run as shell commands.

- **learnings_summary** — **Call first** before non-trivial work. Parameters: `topic` (short description), optional `days` (default 30). Apply the returned summary.
- **summarize_url** — Summarize a web page. Parameters: `url` (HTTPS). On 404, use `suggested_url` / another HTTPS page / **browse_task_start** — never invent content. Never call the built-in `browser` tool.
- **brave_web_search** — Web search via Brave. Parameters: `query` (required), optional `count` (1–20). Prefer this for open-web discovery; then use summarize_url or browse tools on promising URLs.
- **generate_image** — Generate an image from a text prompt. Parameters: `prompt`, optional `style_hint`. After success paste **`paste_exactly` / `media_uri`** (`MEDIA:/…`) on its own line (WhatsApp embed + Dashboard). Do not paste auth-only https `/api/media` URLs.
- **generate_video** — Generate a short video from a prompt. Parameters: `prompt`, optional `duration_sec`. Include the media URL in the reply.
- **kanban_move_status** — You decide. Parameters: `task_id`, `new_status`. → `in_progress` when you start; → `completed` **only after** the deliverable is in the reply. On summarize_url 404/403: one alternate URL or **browse_task_start** (see **AGENT-OS-OPS.md**).
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

## Browser automation

The built-in **`browser`** and **`image`** tools are denied for this agent. For Browser Session, Client Chrome, or multi-step web goals, use **only `browse_*`** content tools below. Never attempt the built-in browser in the same turn.

---

## Client browser session (`browse_*`)

When the CEO has **Client Chrome** ready (Browser Session → opt in + Mark ready + extension Connected), you may use these Agent OS content tools (preferred over inventing scripts):

| Tool | Use |
|------|-----|
| **browse_session_status** | Confirm profile (`chrome` vs `openclaw`), gateway, setup |
| **browse_task_start** | Start NL goal (`mode`: `autonomous`). Recipe replay prefers **browse_recipe_run** (requires that grant) |
| **browse_task_status** | Get task result by `task_id`; pass `wait_ms: 90000` once to wait for `completed` / `failed` / `blocked_on_input` |
| **browse_snapshot** / **browse_act** | Single-step observe/act when not using a full task |
| **browse_recipe_list** | List saved recipes (list grant only — does not play them) |
| **browse_recipe_run** | Play/run a saved recipe (`recipe_name` preferred, or `recipe_id`); returns `task_id`. Requires **browse_recipe_run** tool access |

**Recipe vs autonomous:** If the CEO names a recipe / says run-replay-play / asks for a saved trail → list then **browse_recipe_run**. If the ask matches a known saved pattern (e.g. LinkedIn notifications) → list, match name, run recipe; else autonomous. One-off goals → **browse_task_start** autonomous. Never invent a recipe name.

**Rules:** Use **only** `browse_*` tools. Do not book, pay, submit, or click a Book/Pay control. A booking **search** deep-link may be included in the summary. URL allow/deny rules configured in Browser Session can block opens; do not work around them. See `openclaw-workspace-templates/_shared/AGENT-OS-OPS.md` for the shared browse_* operating rules.

**Async pattern (required - avoids chat timeouts):**
1. Call **browse_task_start** or **browse_recipe_run**. It returns `task_id` at the top level and in `task.id`.
2. **Immediately** tell the CEO the task id and that work continues asynchronously.
3. Optionally call **browse_task_status** once with that id and `wait_ms: 90000`.
4. If the task is `completed`, `failed`, or `blocked_on_input`, report `result.summary` or `wait_reason` honestly. If it is still `running`, keep the CEO's task id in the reply.

A successful `browse_task_*` / `browse_recipe_*` response proves the backend CDP task was accepted. Do not claim "browser tool unavailable"; only the built-in browser is intentionally denied to this agent.

**LinkedIn:** Prefer a saved LinkedIn notifications recipe via **browse_recipe_run**, else `start_url: "https://www.linkedin.com/feed/"`.

**Cheapflights / flights:** Include origin, destination, date, and "direct" if they want nonstops in the `goal`. Prefer omitting a bare homepage `start_url` (backend deep-links to `/flight-search/...`). Summarize prices ascending. Never invent fares.

---

## Virtual Room / charts & media

When the CEO asks in a Virtual Room (or any chat) for images, videos, or charts:

- Call the matching tool and **include the deliverable** (`![generated](url)`, video URL, or chart JSON with real `labels`/`values`).
- Chart types are generic: pie, bar, line, area, scatter — match what they asked for. Prefer **generate_image** of the chart when you do not have accurate numeric series; otherwise emit JSON `{"type":"…","title":"…","labels":[…],"values":[…]}`.
- Never invent Demo/`[1,3,2,5]` placeholders. Multi-ask → every item in one reply. See **AGENT-OS-OPS.md** § Virtual Room.
