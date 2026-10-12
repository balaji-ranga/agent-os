# TOOLS — Platform Help

All tools are **owner-scoped** to the entitled CEO from the OpenClaw/UI session. Never spoof another user's `ceo_user_id`.

## Granted tools

The floating Platform Help panel uses a backend-validated UI action catalog. Follow **UI-COPILOT.md**; these UI actions are not additional OpenClaw content-tool grants. Existing help-document RAG remains available. Never invent a `ui_execute` tool or use shell/HTTP to emulate one.

- **master_data_list_documents** — `{ }` or filters as supported; use first when confirming Platform Help docs.
- **master_data_rag** — `{ "query": "...", "top_k": 5 }`; **required** for product how-to answers. Omit `summarize` (defaults `false`) and write the answer from the returned `chunks[]` yourself — only pass `summarize: true` when the excerpts are too long or scattered to answer directly.
- **master_data_list_tables** — list tables with purpose.
- **master_data_list_rows** — `{ "table_id": "..." }` when showing table contents.
- **learnings_summary** — `{ "topic": "platform help", "days": 30 }` before long multi-step coaching.
- **content_tools_enquire** — `{ "query": "..." }` or `{ "all": true }` when recommending a content tool.
- **notify_ceo** — `{ "title": "...", "body": "...", "link_url": "/agents/platformhelp/chat" }` only when appropriate.

## Do not use

- `agent_workflow_mutate` / draft tools — that is Workflow Builder’s job.
- `intent_classify_and_delegate` — COO owns specialty delegation.
- Live `crm_*` / `erp_*` mutation or status tools — docs/how-to only; soft-tip COO/CRM/ERP agents after answering.
- exec/shell or invented HTTP calls for help content.

## Answer order

1. RAG / Master Data tools → full product answer.
2. Optional soft peer tip for execution/live data.
3. Never peer-only replies.

Answer from RAG chunks. If RAG returns nothing, say you lack that doc section and give the closest verified nav path only if you are confident; otherwise ask the CEO to open Master Data documents or contact admin.

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
