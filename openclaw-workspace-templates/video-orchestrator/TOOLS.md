# TOOLS — Content Orchestrator (Video)

Invoke by **tool name with JSON**. Owner comes from the OpenClaw/CEO session — do not pass other users’ ids.

| Tool | Use |
|------|-----|
| **video_story_status** | **First** on every new story ask — titles, status, pending_ceo_approval, recent_titles_90d, and `paste_block` when exports already exist |
| **video_storyboard_attach** | **Required** to put final PDF/HTML/image into **this chat** — returns `paste_block`; paste every MEDIA: / `/api/media` line on its own line |
| **video_characters_list** | List reusable cast (`character_id`, `ref_media`, `image_id`, `missing_images`) |
| **video_characters_ensure_refs** | Generate portraits for cast missing images → Content Explorer + Master Data |
| **video_characters_bind_upload** | Map a **CEO-uploaded** image to a character name → Master Data |
| **list_inbound_attachments** | Find paperclip uploads before bind-upload / clip ingest |
| **video_media_generate** | **S4** — one clip per scene (**max 8 seconds**). `provider`: `flow_browser` (Google Flow + Desktop Local) or `replicate_api` |
| **video_media_ingest_clip** | Flavour 1: after Flow download, map MEDIA/inbound path → `video_jobs` for `scene_index` |
| **video_media_jobs** | List jobs + asset manifest / missing scenes |
| **video_assemble** | **S5** — FFmpeg + QC → final MP4; sets status **`video_generated`** (no video model) |
| **browse_session_status** / **browse_task_start** / **browse_task_status** | Flavour 1 Desktop Local worker for Flow (optional direct use; prefer `video_media_generate`) |
| **generate_video** | Low-level Replicate Veo; prefer `video_media_generate` for storyboards |
| **master_data_rag** / **master_data_list_rows** / **master_data_list_documents** | Cross-check story/cast knowledge + RAG docs |
| **agent_workflow_list** / **agent_workflow_enquire** | Find published video workflows |
| **agent_workflow_trigger** | `run video storyboard` · `run video media` · `run video assembly` |
| **agent_workflow_runs** / **agent_workflow_watch** | Track runs / notify on terminal |
| **video_characters_save** | Metadata-only character upsert |
| **video_storyboard_export** | Export storyboard JSON → HTML/PDF/SVG |
| **kanban_create_task** / **kanban_move_status** | Extra CEO tasks if needed |
| **notify_ceo** | Bell when a board/final is ready |
| **learnings_summary** | CEO preferences before non-trivial runs |
| **content_tools_enquire** | Discover tool purposes |

## Phase 2 (S4 → S5)

1. Storyboard must be **`ceo_approved`**.
2. **S4** — `video_media_generate` with `storyboard_id` + `provider` (`flow_browser` or `replicate_api`). Each scene is **≤8s** (Flow/Veo limit) — never one long clip for the whole story.
3. Flavour 1: if worker offline or clip only on disk, **`video_media_ingest_clip`** per scene.
4. **S5** — `video_assemble` → paste `paste_block` for final MP4. Status becomes **`video_generated`**.

## Attaching finals in chat (hard rule)

1. Call **`video_storyboard_attach`** (PDF/HTML) or paste **`video_assemble`** / media `paste_block`.
2. Each `MEDIA:…` or `/api/media/…` line on **its own line**.

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
