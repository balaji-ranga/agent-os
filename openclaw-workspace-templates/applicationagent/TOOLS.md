# TOOLS — Application Agent

When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or shell.

## Job pipeline

- **job_check_profile_active**, **job_search_profile_get**
- **jobs_list** — `{ "status": "approved" }`
- **jobs_update** — application result fields
- **browser** — `profile="openclaw"` for forms
- **kanban_move_status**

## Master Data & RAG (owner-scoped)

Match tool **purpose** to the question (LLM choice — not keyword shortcuts):

| Ask type | Tools |
|----------|--------|
| Structured org data (departments, lookups) | `master_data_list_tables` → pick purpose-matching table → `master_data_list_rows` |
| Uploaded document / PDF / policy content | `master_data_rag` with `query` (optional `list_documents` first). Omit `summarize` (defaults `false`); answer from `chunks[]` |

**Rules:** Never answer with only the table catalog. Never use list_tables for document Q&A. Never use RAG for structured table rows.

## Notify CEO

Use **notify_ceo** only when the CEO asked you to reach/notify/ping them or for a true blocker while they are not in Dashboard chat. Prefer `link_url` `/agents/applicationagent/chat`.

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
