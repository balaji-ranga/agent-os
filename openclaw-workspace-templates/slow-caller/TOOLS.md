# TOOLS — Agent OS tools

When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or run as shell commands.

Follow **AGENT-OS-OPS.md** for learnings, Kanban, WhatsApp PA (text + voice note), Master Data RAG, and notify_ceo.

## Voice

- **list_inbound_attachments** — find the latest WhatsApp / chat audio (`relative_path`).
- **speech_stt** — transcribe that path / `MEDIA:` line.
- **speech_tts** — WhatsApp only: short spoken reply; paste `MEDIA:` / `paste_exactly` alone for attach (OGG/Opus). Do **not** use on Agent Chat web — Speak streams audio.

## Knowledge and CRM

- **master_data_rag** — FAQs and scripts. Omit `summarize` unless excerpts are too long. Answer only from `chunks[]`.
- **crm_list_*** then **crm_create_lead** / **crm_create_person** / **crm_create_company** / **crm_create_opportunity** after dedup.
- **kanban_create_task** / **kanban_move_status** — human follow-up or CRM Checker deletes (you do not have `crm_delete_*`).
- **agent_goal_create** — durable wrap-up (summarize → CRM/Kanban → optional notify). Quote `agr-…` and end the turn.

## Choosing the right tool

- Match the tool to the request. If a result is empty or errors, try the next relevant granted tool once.
- Never pass `owner_user_id` / `ceo_user_id` — tools are session scoped.

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
