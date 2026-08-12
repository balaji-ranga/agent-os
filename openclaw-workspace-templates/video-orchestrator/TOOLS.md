# TOOLS — Content Orchestrator (Video)

Invoke by **tool name with JSON**. Owner comes from the OpenClaw/CEO session — do not pass other users’ ids.

| Tool | Use |
|------|-----|
| **video_story_status** | **First** on every new story ask — titles, status, pending_ceo_approval, recent_titles_90d |
| **master_data_rag** / **master_data_list_rows** / **master_data_list_documents** | Cross-check story/cast knowledge + RAG docs |
| **master_data_index_document** | Rare manual re-index (exports usually auto-index) |
| **agent_workflow_list** / **agent_workflow_enquire** | Find published video workflows |
| **agent_workflow_trigger** | Start storyboard graph (`run video storyboard`) |
| **agent_workflow_runs** / **agent_workflow_watch** | Track runs / notify on terminal |
| **video_characters_save** | Upsert reusable character_id cards (after CEO confirms cast) |
| **video_storyboard_export** | Export storyboard JSON → HTML/PDF/SVG + MEDIA: + video_storyboards row (also auto-run at storyboard CEO gate) |
| **generate_image** | Optional character sheet or contact-sheet image **after** cast is known |
| **kanban_create_task** / **kanban_move_status** | Extra CEO tasks if needed (workflow gates create their own) |
| **notify_ceo** | Bell when a board is ready (if not already in chat) |
| **learnings_summary** | CEO preferences before non-trivial runs |
| **content_tools_enquire** | Discover tool purposes |

Phase 2 (when granted): **generate_video** (Replicate `google/veo-*` via Tools→Model / BYOK).
