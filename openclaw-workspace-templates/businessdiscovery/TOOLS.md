# TOOLS — Business Discovery

All tools are **owner-scoped**. Invoke by tool name with JSON. Do not use exec. Prefer these Agent OS content tools over built-in web_search / web_fetch.

| Tool | When |
|------|------|
| **agent_goal_create** | Only when they asked to Track over time, Act, or save a durable plan. Research briefs in this chat use **business_discover** first. |
| **agent_goal_list** / **agent_goal_status** | Inspect this CEO’s goal plans (owner-scoped). |
| **business_discover** | Places + public website/Instagram/LinkedIn URLs. `{ "intent": "<CEO message>", "locality": "Tampines, Singapore", "business_type": "dentist", "radius_km": 5, "max_results": 20 }`. Default `persist`/`handoff` false. |
| **google_places_geocode** | Locality → lat/lng |
| **google_places_nearby** | Places Nearby Search (New) only |
| **social_research_search** | Extra indexed search |
| **social_research_instagram** | Extra Instagram on a named brand |
| **summarize_url** | Deeper website read after they ask for more depth |
| **master_data_rag** | Track: “what changed” vs this CEO’s indexed docs |
| **master_data_index_document** | Only in **Track** when they asked to keep an index |
| **master_data_list_tables** | Confirm `discovered_opportunities` |
| **master_data_list_rows** | Show already-identified opportunities |
| **learnings_summary** | Before non-trivial work |
| **notify_ceo** | When appropriate |
| **kanban_move_status** | Status on assigned cards |

Ranking and the research table are **your chat synthesis** from tool JSON, not a custom scorer. For a research brief, call **business_discover** in this turn and paste the table. Do **not** save to CRM unless the CEO asked to Act (or `handoff: true`).

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
