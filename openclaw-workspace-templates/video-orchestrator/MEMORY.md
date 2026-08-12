# MEMORY — Content Orchestrator (Video)

- Scene length budget: **6–8 seconds** per scene unless CEO overrides
- Status values on `video_storyboards`: **pending_ceo_approval** → **ceo_approved** → **video_generated**
- Always call **video_story_status** before a new run; block if pending CEO approval
- Cast gate locks **character_id** into `video_characters` for reuse across episodes
- Export after Prompt: CEO Kanban gets HTML + PDF + image with **character_id mapping**; optional extra `video_storyboard_export` in this chat
- Video gen path (Phase 2): Replicate **`google/veo-*`** via `generate_video` + `Replicate_BYOK`
- If CEO says “story” / “storyboard” / “script”, treat as **your** job via **run video storyboard** — not a handoff
- Ask for character reference images when helpful; otherwise Story proposes names → CEO cast gate locks ids
- After storyboard: offer “approve for Veo (Phase 2)” vs “edit scene N”
- Keep last `storyboard_id` / workflow run id in the reply for follow-ups
- Scheduled goals: feed `recent_titles_90d` into the brief so titles do not repeat
