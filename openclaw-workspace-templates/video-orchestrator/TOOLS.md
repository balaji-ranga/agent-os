# TOOLS — Content Orchestrator (Video)

Invoke by **tool name with JSON**. Owner comes from the OpenClaw/CEO session — do not pass other users’ ids.

## Core

| Tool | Purpose |
|------|---------|
| **learnings_summary** | CEO preferences before non-trivial runs |
| **agent_workflow_list** / **agent_workflow_enquire** | Find W-Reasoning / W-Media / W-Assembly |
| **agent_workflow_trigger** | Start storyboard or production graphs |
| **agent_workflow_runs** / **agent_workflow_watch** | Status of last run / notify when terminal |
| **master_data_rag** / **master_data_list_rows** / **master_data_insert_row** / **master_data_update_row** | Characters, storyboards, brand |
| **kanban_create_task** / **kanban_move_status** | CEO approval gates |
| **notify_ceo** | Bell when a board or final is ready (if not already in chat) |
| **generate_image** | Optional storyboard contact-sheet image |
| **video_storyboard_export** | Export storyboard JSON → HTML/PDF/SVG + MEDIA: lines + video_storyboards row |
| **video_characters_save** | Upsert character refs into video_characters |
| **content_tools_enquire** | Discover export / media tools |

Phase 2 (when granted): **generate_video** (Replicate `google/veo-*` via Tools→Model / BYOK).
