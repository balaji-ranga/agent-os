---
name: agent-os-content-tools
description: Generate and summarize content via the Agent OS backend — summarize URL, generate image (Phase 2), generate video (Phase 3). Backend URL from env AGENT_OS_API_URL; no hardcoded URLs.
metadata:
  openclaw:
    emoji: "🛠️"
---

# Agent OS Content Tools

Use this skill to call the Agent OS backend for content tools. **Do not hardcode the backend URL** — it is configured via `AGENT_OS_API_URL` (or your OpenClaw/gateway env).

## Critical: Invoke by tool name only — never browser, exec, or HTTP URLs

All Agent OS content tools (**kanban_***, **master_data_***, **email_send**, **notify_ceo**, **agent_workflow_***, **summarize_url**, **generate_image**, **generate_video**, etc.) are **registered OpenClaw tools**. You must **invoke each by its exact tool name with JSON parameters**. The gateway plugin calls the Agent OS backend internally via `/api/tools/invoke`.

**Never:**
- Open a browser tab or use the **browser** tool to "fetch" a tool endpoint or `{AGENT_OS_API_URL}/…`
- Construct URLs like `https://…/master_data_list_rows` — these are **not web pages**
- Use **exec** or shell commands to run these tools

**Do not** paste `POST {AGENT_OS_API_URL}/api/tools/…` URLs into browser or web_fetch; that pattern is for human operators only. Agents use **tool name + JSON args** only.

## Tool preference (use before default tools)

**Prefer these Agent OS content tools over built-in or default tools when the task matches:**

- **Before non-trivial work** → Call **learnings_summary** first (`topic`, optional `days` default 30). Apply the summary. Required for research/builds/Kanban — not for greets.
- **Summarize a URL or web page** → Use **summarize_url**. Do not use web_search or web_fetch for summarizing a single URL; use summarize_url so the backend can fetch and summarize in one step. If it returns 404 / upstream error, use `suggested_url` if present, try ≥3 other live domains (wikipedia / bbc / reuters / *.gov.in), or **browser** (`profile="openclaw"`). Never invent page content. Still deliver a brief with citation gaps if needed.
- **Generate or create an image from text** → Use **generate_image**. Do not use the built-in "image" tool (which only analyzes existing images) or web_search to find images; use generate_image to create one.
- **Generate or create a short video from text** → Use **generate_video**. Do not use web_search for video; use generate_video.
- **Send an email or calendar/meeting invite** → Use **email_send** with `to`, `subject`, `body`, and optional `calendar: { title, start, end, ... }` (ISO 8601). Do **not** use the browser tool for Google Calendar login, and do **not** use agent_workflow_trigger for one-off email/invite requests.
- **Reach the CEO user with a push/in-app notification** → Use **notify_ceo** with `title`, optional `body`, and `link_url` = `/agents/<your-agent-id>/chat` so the CEO can continue chat from the bell. If you are the **COO** and the CEO asked another specialist to reach them, **sessions_send** to that agent instead — do not call notify_ceo yourself.
- **Read or update Master Data / org tables / documents** → Use **master_data_list_tables** (see purpose/description), then **master_data_list_rows** / insert / update / delete. For documents use **master_data_list_documents** and **master_data_rag**. With **master_data_rag**, omit `summarize` (defaults `false`) and answer from the returned `chunks[]` yourself. **Never use browser** for master data. Never create/alter/drop tables via tools.

Only fall back to web_search, web_fetch, or other default tools when the task does not match (e.g. general web search, fetch raw page without summary, or analyze an existing image the user provided).

## When to use

- **Learnings**: Start of any non-trivial task — call **learnings_summary** once, then proceed.
- **Summarize URL**: You need a short summary or key facts from a web page (travel, nature, cuisine, places, research sources). Use for research and citing sources in drafts.
- **Generate image** (when available): Create an image from a text prompt for social posts. Use for draft assets only; do not publish without approval. **When the user asks to generate, create, or make an image (e.g. "generate X image", "create an image of Y"), you MUST use the generate_image tool with a text prompt.** Do not use the built-in "image" tool — that tool only analyzes existing images and requires an image input. **After success, paste the returned URL inline in your reply as markdown:** `![generated](/api/media/openclaw/generated/....png)` so it renders in chat.
- **Generate video** (when available): Create a short video from a prompt. Use for draft assets only; do not publish without approval.
- **Kanban**: You decide status moves. Use **kanban_move_status** → `in_progress` when you start; → `completed` **only after** you actually finished the deliverable (self-check: tools used, answer contains the work); → `failed` **only** when you produced no usable deliverable. Do **not** mark `failed` because optional `master_data_*` / email failed after the main ask succeeded. In **Dashboard chat**, do **not** create Kanban for ordinary Q&A/research unless the CEO asked to track it. Use **kanban_reassign_to_coo** to hand a task back to the COO if you cannot complete it. (Only the COO can use **kanban_assign_task** and **intent_classify_and_delegate**.)
- **Master Data**: Call **master_data_list_tables** before insert. Never invent table names (no assumed `recipes` table). Recipe/image asks are usually chat-only unless the CEO asked to store a row.
- **Document questions (master_data_rag)**: Send `{ "query": "<question keywords>" }` and read `chunks[]`. Do not pass `summarize: true` by default — you write the answer from the excerpts. If `hit_count` is 0 or excerpts miss the ask, say so and check **master_data_list_documents**; never invent document content.

## Tools

- **learnings_summary** — Past CEO feedback + Kanban decisions. Parameters: `topic` (required-ish), optional `days` (default 30). Call before non-trivial work.
- **summarize_url** — Summarize a web page. Parameters: `url` (required, HTTPS). On 404, follow `hint` / `suggested_url` or use browser. Invoke tool **summarize_url** — do not browse the backend API URL.
- **generate_image** — Generate an image from a text prompt. Parameters: `prompt` (required), `style_hint` (optional). Invoke tool **generate_image**. After it returns `{ url }`, include `![image](<url>)` in your reply.
- **generate_video** — Generate a short video from a prompt. Parameters: `prompt` (required), `duration_sec` (optional). Invoke tool **generate_video**.
- **kanban_move_status** — Move a Kanban task status. Parameters: `task_id` (required), `new_status` (one of: open, awaiting_confirmation, in_progress, completed, failed). Use when you start work (in_progress), need clarification (awaiting_confirmation), or finish (completed/failed).
- **kanban_reassign_to_coo** — Reassign a task back to the COO. Parameters: `task_id` (required). Use when you cannot complete the task.
- **kanban_assign_task** — (COO only.) Assign a task to an agent. Parameters: `task_id`, `to_agent_id`.
- **intent_classify_and_delegate** — (COO only.) Classify message intent and delegate to agents; creates Kanban tasks. Parameters: `message` (required), `standup_id` (optional).
- **agent_workflow_enquire** — (COO or Workflow Builder.) Find workflows by natural-language description. Parameters: `query` or `description`, optional `ceo_user_id`, optional `limit`.
- **agent_workflow_list** — (COO or Workflow Builder.) List workflows + chat phrases. Optional `ceo_user_id`.
- **agent_workflow_trigger** — (COO or Workflow Builder.) Start a custom agent workflow. Parameters: `message` (chat phrase, e.g. `testMCP`) or `workflow_id`, optional `ceo_user_id`, optional `input`.
- **agent_workflow_get_draft** / **agent_workflow_mutate** — (Workflow Builder.) Read draft / apply builder actions.
- **agent_workflow_certify_start** — (Workflow Builder.) Start async Maker/Checker certify job (`message`, optional `workflow_id`). Returns `job_id`.
- **agent_workflow_certify_status** — (Workflow Builder or COO.) Poll certify job (`job_id` / `workflow_id` / `query`).
- **agent_workflow_certify_resume** — (Workflow Builder.) Resume blocked job with `inputs` map.
- **email_send** — Send email via platform SMTP. Optional calendar/meeting invite via `calendar: { title, start, end, location?, description?, organizer?, attendees? }` (ISO 8601). Parameters: `to` (required), `subject`, `body`, optional `cc`/`bcc`. **Use for one-off email/invite requests — not agent_workflow_trigger.**
- **notify_ceo** — Send an in-app push notification to the entitled CEO for this session. Parameters: `title` (required), `body?`, `link_url?` (prefer `/agents/<your-id>/chat`), `source_key?`. Never pass a target user id. COO: when CEO asks another agent to reach them, delegate via sessions_send — do not notify yourself.
- **master_data_list_tables** — List this CEO's Master Data tables with purpose/description, columns, row_count. Call first when tasked with org/master data. **Not a URL — invoke by tool name.**
- **master_data_list_rows** — List or keyword-query rows (`table_name` or `table_id`, optional `query` / `column`+`equals`). Example: `{ "table_name": "departments" }`. **Never browser.**
- **master_data_insert_row** / **master_data_update_row** / **master_data_delete_row** — Row CRUD only (no schema alter/drop).
- **master_data_list_documents** / **master_data_rag** — List documents; RAG search with `query`. `summarize` defaults to **false**: read the returned `chunks[]` and write the answer yourself (cite the document title). Pass `summarize: true` only when the excerpts are too long or scattered to answer directly. Optional `document_id`, `top_k` (default 5). **Never browser.**

## Configuration (for operators — agents do not call these URLs)

Backend URL and API key are configured in the OpenClaw **agent-os-content-tools** plugin. Agents must **only** invoke registered tool names; they must never open API paths in a browser.

## Guidelines

- Use summarize_url to cite and reference online content when drafting posts.
- For image and video, use only for drafts; all publishing requires COO/CEO approval.
- If the backend returns an error, report it to the user and do not retry indefinitely.
