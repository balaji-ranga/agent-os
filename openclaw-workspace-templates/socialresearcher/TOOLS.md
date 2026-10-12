# TOOLS — Social Researcher

All tools are **owner-scoped**. Invoke by tool name with JSON. Do not use exec. Prefer these Agent OS content tools over built-in web_search / web_fetch.

Report from **`posts[]`**. **`indexed_results` / `results` are search hits, not a post feed.**

| Tool | When |
|------|------|
| **social_research_profile** | Brand across Instagram / X / LinkedIn / Facebook. `{ "brand": "Nike", "days": 30, "platforms": ["instagram","x"] }` |
| **social_research_instagram** | Instagram handle. Self-hosted Instaloader sidecar (vault `INSTAGRAM_SESSIONID`) or hydrated `/p/` images. 429s are instagram.com, not a SaaS Instaconnect. |
| **social_research_x** | X handle. Official API (`X_API_BYOK` / `X_BEARER_TOKEN`) or hydrated status URLs (text + media). |
| **social_research_facebook** | Facebook. Meta Graph if connected (owned Pages only); else indexed search. |
| **social_research_search** | Indexed Brave search. Optional `site` (`linkedin.com`, `facebook.com`, `instagram.com`, `x.com`). Not a tweet/IG feed. |
| **google_places_geocode** / **google_places_nearby** | Official Places API (New) locality search. Lead CRM handoff is Business Discovery. |
| **brave_web_search** | Extra web results |
| **summarize_url** | Summarise one HTTPS page (prefer this over web_fetch) |
| **browse_session_status** / **browse_task_start** / **browse_task_status** | Only if search is empty and Client Chrome is ready |
| **learnings_summary** | Before non-trivial work |
| **notify_ceo** | `{ "title", "body", "link_url": "/agents/<your-id>/chat" }` when appropriate |
| **kanban_move_status** | Status on assigned cards |

If `posts` is empty, quote `next_step` and stop inventing captions. Do not “fill in” from websearch snippets.

For Browser Session work, use **only `browse_*` tools**. Never call the native built-in `browser` tool before or after a `browse_*` task in the same request. Call `browse_session_status` first. If the CEO explicitly requires Desktop Local, pass its returned `desktop_worker.driver_mode` as `preferred_driver` and `allow_fallback:false`; report `EXECUTOR_OFFLINE` if unavailable rather than switching to managed Playwright. Always report the task's actual `selected_driver_mode`.

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
