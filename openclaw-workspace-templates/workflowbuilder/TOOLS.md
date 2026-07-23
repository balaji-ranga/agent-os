# TOOLS — Workflow Builder

All tools are **owner-scoped** to the entitled CEO from the OpenClaw/UI session. Never spoof another user's `ceo_user_id`.

## Granted tools

- **learnings_summary** — before non-trivial work: `{ "topic": "...", "days": 30 }`
- **content_tools_enquire** — list/search content tools by purpose:
  - `{ "query": "summarize a URL" }` → ranked matches + `top_recommendation`
  - `{ "all": true }` → full enabled catalog (`name`, `display_name`, `purpose`)
- **agent_workflow_list** — list this CEO's workflows (drafts included by default for Workflow Builder). Optional: `chat_only`, `include_drafts`.
- **agent_workflow_enquire** — search by query, or `all: true`. Drafts included by default for Workflow Builder.
- **agent_workflow_get_draft** — `{ "workflow_id": "..." }`
- **agent_workflow_mutate** — `{ "workflow_id": "...", "actions": [ ... ] }`
  - Include `list_content_tools` / `enquire_content_tools` when recommending or picking a tool node.
  - Include `until_success` for short sync build-test loops.
  - Include `until_certified` with `"async": true` only if you cannot use certify_start (prefer certify_start).
- **agent_workflow_certify_start** — start autonomous Maker/Checker certify (async):
  - `{ "message": "Build a URL summarizer and certify until it works", "workflow_id": "optional" }`
  - Returns `job_id` immediately. Tell the CEO they can ask for status anytime.
- **agent_workflow_certify_status** — pull updates on request:
  - `{ "job_id": "cert-..." }` or `{ "workflow_id": "..." }` or `{ "query": "url summarizer" }`
- **agent_workflow_certify_resume** — after `blocked_on_input`:
  - `{ "job_id": "cert-...", "inputs": { "nodes.brain-1.task_config.apiKey": "..." } }`
- **agent_workflow_trigger** — start a published run: `message` (chat phrase) and/or `workflow_id`

When the CEO uses the Workflows UI chat panel, the backend agent-chat API applies the same mutations and updates the canvas live (preferred path for iterative building). The Runtime environment already injects the full content-tools catalog (name + purpose).

Do not use `job_run_workflow_now` — that is for the Job Applicant pipeline only.
Do not use exec/shell to invent workflow HTTP calls.
