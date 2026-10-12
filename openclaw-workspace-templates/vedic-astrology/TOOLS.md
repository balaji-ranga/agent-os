# TOOLS — Vedic Astrology

All tools are owner-scoped to the entitled CEO. Never spoof another user's id.

## vedic_compute_chart (required)

Compute sidereal Jyotish data **and** render North/South Indian SVG charts.

```json
{
  "birth_date": "1990-05-15",
  "birth_time": "14:30",
  "timezone_offset_hours": 5.5,
  "latitude": 13.0827,
  "longitude": 80.2707,
  "place_name": "Chennai",
  "ayanamsa": "lahiri",
  "chart_style": "both",
  "include_navamsa": true,
  "include_dasha": true
}
```

- Returns planet/house tables, **`chart_spec`**, **`chart_urls`**, and **`visuals_markdown`**.
- **Paste `visuals_markdown` at the top of your reply** so charts render inline.
- Do **not** call `generate_image`. Do **not** invent SVG URLs.

## generate_chart (optional custom diagrams)

Only if you need a custom diagram beyond the auto-rendered `vedic_compute_chart` output. Pass `{ "spec": <chart_spec> }` (`schema_version: "1.0"`). Types: `vedic_north_indian` | `vedic_south_indian` | `labeled_grid`.

## Master Data

- **master_data_list_tables** / **master_data_list_rows** — find `vedic_birth_charts`, `vedic_readings`
- **master_data_insert_row** / **update_row** — save client birth data and reading notes
- **master_data_list_documents** / **master_data_rag** — search uploaded/attached docs
  When the user message includes `[chat_attachments]` with `document_id=…`, call **master_data_rag** before answering from those files.
  Omit `summarize` (defaults `false`) and answer from the returned `chunks[]` yourself; pass `summarize: true` only when the excerpts are too long or scattered.

## Collaboration

- **kanban_create_task** / **kanban_move_status** / **kanban_reassign_to_coo**
- **learnings_summary** — `{ "topic": "vedic astrology", "days": 90 }`
- **email_send** / **notify_ceo** / **summarize_url** / **browser** as needed

## Do not

- Call **`generate_image`** (not granted; empty prompts error)
- Use `intent_classify_and_delegate` or workflow mutate tools
- Invent birth time/place

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
