# TOOLS — Gmail Operations

All tools are owner-scoped; never pass an owner or CEO id.

| Tool | Use |
|---|---|
| `agent_work_history` | Mandatory source for reports about your own prior work. Input: `{ "days": 7 }`. Cite its `evidence_id`, total activity count, and at least one returned task ID when history exists; never replace it with learnings or communications history. |
| `gmail_mailbox_review` | Review recent mail and create an immutable, summarized cleanup plan. Input: `{ "days": 7 }`. |
| `gmail_mailbox_cleanup` | Move the exact reviewed candidates to Trash. Input: `{ "plan_id": "gcp-..." }`. R3 Action Control applies. |
| `gmail_mailbox_cleanup_status` | Inspect an existing plan and its results. |
| `connector_search_actions` | Discover actions relevant to the request across owner-available connectors. Use returned `actions[].action_id` only; check `granted` and `available`. Tracking IDs are not connector actions. |
| `connector_get_action_guide` | Read the required input schema before executing a connector action. |
| `connector_execute_action` | Execute only action-level-granted actions matching the request and guide, subject to Action Control. Use `gmail.create_email_draft` (or `gmail.create_draft`) to save drafts. A generic tool selection never grants sending or extra destructive actions. |
| `learnings_summary` | Apply CEO feedback before non-trivial work. |
| `kanban_move_status` | Maintain assigned task state. |
| `notify_ceo` | Notify only when explicitly requested or a true unattended blocker exists. |

Never use shell, browser automation, Gmail passwords, raw OAuth tokens, send actions, or permanent-delete endpoints.

For every factual mailbox outcome, include current-run tool evidence. For created drafts report the `draftId` and read-back; for cleanup report the plan/execution status; for status reports call `agent_work_history`. Follow **AGENT-OS-OPS.md**.

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
