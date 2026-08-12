# TOOLS — Content Orchestrator (Video)

Invoke by **tool name with JSON**. Owner comes from the OpenClaw/CEO session — do not pass other users’ ids.

| Tool | Use |
|------|-----|
| **video_story_status** | **First** on every new story ask — titles, status, pending_ceo_approval, recent_titles_90d, and `paste_block` when exports already exist |
| **video_storyboard_attach** | **Required** to put final PDF/HTML/image into **this chat** — returns `paste_block`; paste every MEDIA: / `/api/media` line on its own line |
| **video_characters_list** | List reusable cast (`character_id`, `ref_media`, `image_id`, `missing_images`) |
| **video_characters_ensure_refs** | Generate portraits for cast missing images → Content Explorer + Master Data `video_characters` (`ref_media` + `image_id`). Reuses existing unless `force_regenerate` |
| **video_characters_bind_upload** | Map a **CEO-uploaded** image to a character name → same Master Data row. If name missing, tool returns `ask_ceo` — ask the CEO, then call again |
| **list_inbound_attachments** | Find paperclip uploads before bind-upload |
| **master_data_rag** / **master_data_list_rows** / **master_data_list_documents** | Cross-check story/cast knowledge + RAG docs |
| **master_data_index_document** | Rare manual re-index (exports usually auto-index) |
| **agent_workflow_list** / **agent_workflow_enquire** | Find published video workflows |
| **agent_workflow_trigger** | Start storyboard graph (`run video storyboard`) |
| **agent_workflow_runs** / **agent_workflow_watch** | Track runs / notify on terminal |
| **video_characters_save** | Upsert character cards without generating images (metadata-only) |
| **video_storyboard_export** | Export storyboard JSON → HTML/PDF/SVG when you have fresh JSON (gates also auto-export) |
| **generate_image** | Prefer **video_characters_ensure_refs** for reusable portraits; use generate_image only for one-off sheets |
| **kanban_create_task** / **kanban_move_status** | Extra CEO tasks if needed (workflow gates create their own) |
| **notify_ceo** | Bell when a board is ready (if not already in chat) |
| **learnings_summary** | CEO preferences before non-trivial runs |
| **content_tools_enquire** | Discover tool purposes |

## Character images (generate + upload)

### Generate / reuse (cast)

1. After Story names cast (or before cast Kanban review): call **`video_characters_ensure_refs`** with `{ characters: [{ name, role, appearance, character_id? }] }`.
2. Portraits land under Content Explorer `media/generated/<ceo>/`; Master Data gets `ref_media` + `image_id`.
3. Paste `paste_block` so the CEO sees faces. Cast gate also auto-ensures refs.

### CEO upload → name → Master Data

1. CEO attaches an image → **`list_inbound_attachments`** (or use the MEDIA / `/api/media` path from chat).
2. Call **`video_characters_bind_upload`** with `{ relative_path | media, character_name }`.
3. If `character_name` is missing, the tool returns **`ask_ceo`** — ask “What character name should I map this to?”, then call again with the name.
4. Paste `paste_block` to confirm the stored portrait.

## Attaching finals in chat (hard rule)

1. Call **`video_storyboard_attach`** with `storyboard_id` or `title` (or omit for newest).
2. Copy **`paste_block`** into your reply verbatim — each `MEDIA:…` or `/api/media/…` line on **its own line**.
3. Do not wrap those lines in backticks or a single paragraph — Dashboard/WhatsApp need bare lines to render PDF/HTML/SVG.

Phase 2 (when granted): **generate_video** (Replicate `google/veo-*` via Tools→Model / BYOK).
