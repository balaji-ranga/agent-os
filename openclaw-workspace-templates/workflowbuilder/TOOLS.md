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

## Multi format content generation conversion and OCR

When granted, call **multi-format-content-tool** by its exact name with JSON. It generates PDF, Word (docx or legacy doc), Excel (xlsx), txt and sanitized HTML; converts Word to PDF, PDF to editable Word/text, PDF pages to png/jpg, images to PDF, and OCRs images/scanned PDFs. This is deterministic private processing, not a browser or shell action.

- Prefer an existing **Content Folder** reference: `content_file: {id: "up:inbound/attachments/report.pdf"}`, `{id: "gen:downloads/<owner>/<uuid>.pdf"}`, or `{relative_path: "inbound/attachments/report.pdf"}`. For a generated file, copy **files[].content_file_id** unchanged into `content_file: {id: ...}`; never rewrite it as inbound/attachments. Use exact item IDs/paths returned by tools; do not invent paths or resend a whole file. A unique `{filename: "report.pdf"}` is also accepted. Only this authenticated company's files are accessible.
- Otherwise supply exactly one of `text` with `input_format: "txt"|"md"|"html"`, `content_base64` plus `input_format`/`input_filename`, or `formatted_input` as blocks: heading {text,level}, paragraph/list {text}, table {rows:[[...]]}.
- Required `output_format`: pdf, docx, doc, xlsx, txt, html, png or jpg. Optional `operation`: generate, convert (default), ocr. `ocr`: auto (default), force, off. `language`: eng (default), spa, fra, deu or plus-separated combinations. Optional `output_filename` sets the display filename.
- Example generation: {"text":"# Weekly report\n\n| Item | Count |\n| --- | --- |\n| Leads | 12 |","input_format":"md","output_format":"pdf","operation":"generate"}.
- Example file conversion: {"content_file":{"relative_path":"inbound/attachments/report.docx"},"output_format":"pdf"}. Example OCR: {"content_file":{"relative_path":"inbound/attachments/scan.png"},"operation":"ocr","output_format":"docx"}.
- Paste **each files[].paste_exactly** unchanged on its own line to attach in the current channel. Never manufacture a file link or use a public signed URL. Antivirus input/output scanning is required; failures/infection block delivery. Source files are unchanged. Limits: 25 MiB combined output, 20 PDF pages; no macros, encrypted Office/PDF inputs or network-loaded resources.
- Preserve returned warnings. PDF-to-Word reconstructs editable text, not guaranteed original layout; OCR can misread text/numbers. Excel uses source tables or a Content sheet and never executes input formulas. Review important conversions before claiming exact fidelity.
- If not granted, ask for the tool grant in Agent Workspace; documenting this tool does not authorize its use.
