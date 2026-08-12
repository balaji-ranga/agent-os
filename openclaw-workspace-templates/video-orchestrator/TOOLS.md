# TOOLS — Content Orchestrator (Video)

Invoke by **tool name with JSON**. Owner comes from the OpenClaw/CEO session — do not pass other users’ ids.

| Tool | Use |
|------|-----|
| **video_story_status** | **First** on every new story ask — titles, status, pending_ceo_approval, recent_titles_90d, and `paste_block` when exports already exist |
| **video_storyboard_attach** | **Required** to put final PDF/HTML/image into **this chat** — returns `paste_block`; paste every MEDIA: / `/api/media` line on its own line |
| **master_data_rag** / **master_data_list_rows** / **master_data_list_documents** | Cross-check story/cast knowledge + RAG docs |
| **master_data_index_document** | Rare manual re-index (exports usually auto-index) |
| **agent_workflow_list** / **agent_workflow_enquire** | Find published video workflows |
| **agent_workflow_trigger** | Start storyboard graph (`run video storyboard`) |
| **agent_workflow_runs** / **agent_workflow_watch** | Track runs / notify on terminal |
| **video_characters_save** | Upsert reusable character_id cards (after CEO confirms cast) |
| **video_storyboard_export** | Export storyboard JSON → HTML/PDF/SVG when you have fresh JSON (gates also auto-export) |
| **generate_image** | Optional character sheet or contact-sheet image **after** cast is known |
| **kanban_create_task** / **kanban_move_status** | Extra CEO tasks if needed (workflow gates create their own) |
| **notify_ceo** | Bell when a board is ready (if not already in chat) |
| **learnings_summary** | CEO preferences before non-trivial runs |
| **content_tools_enquire** | Discover tool purposes |

## Attaching finals in chat (hard rule)

1. Call **`video_storyboard_attach`** with `storyboard_id` or `title` (or omit for newest).
2. Copy **`paste_block`** into your reply verbatim — each `MEDIA:…` or `/api/media/…` line on **its own line**.
3. Do not wrap those lines in backticks or a single paragraph — Dashboard/WhatsApp need bare lines to render PDF/HTML/SVG.

Phase 2 (when granted): **generate_video** (Replicate `google/veo-*` via Tools→Model / BYOK).
