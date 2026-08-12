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
