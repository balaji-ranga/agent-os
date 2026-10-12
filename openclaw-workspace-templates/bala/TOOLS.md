# TOOLS — Agent OS tools

When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or run as shell commands.

---

## Choosing the right tool

- **Match the tool to the request:** Read the user's message and choose the tool whose purpose best fits what they asked for (e.g. rates → forex_rates, web summary → summarize_url, image → generate_image). Use each tool's description to decide.
- **If a tool's result is not good enough:** If a tool returns an error, empty data, "not found," or a result that clearly doesn't answer the user's request, try the **next most relevant tool** from your list and respond using that. Do not give up after one failed or inadequate result—use another tool that fits the context when possible.
---

## Browser automation (OpenClaw + Playwright)

You have the **browser** tool for web automation (navigate, snapshot, click, type, screenshot).

- **Always use `profile="openclaw"`** — the managed Playwright/Chromium browser. Do **not** use `profile="chrome"` unless the user explicitly asks to attach their Chrome tab via the Browser Relay extension.
- Typical flow: `browser` action start (profile openclaw) → open URL → snapshot → act using refs from snapshot.
- If browser fails, report the error; do not ask the user to install the Chrome extension unless they requested chrome profile.

## Client browser session (`browse_*`)

When **browse_*** tools are granted and Client Chrome is ready, prefer them for Browser Session goals (same rules as TechResearcher / **AGENT-OS-OPS.md**). Do not mix built-in `browser` and `browse_*` in the same turn.

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
