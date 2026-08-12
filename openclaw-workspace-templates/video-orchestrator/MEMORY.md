# MEMORY — Content Orchestrator (Video)

- Scene length budget: **6–8 seconds** per scene unless CEO overrides
- Status values on `video_storyboards`: **pending_ceo_approval** → **ceo_approved** → **video_generated**
- Always call **video_story_status** before a new run; block if pending CEO approval
- After approval / “show me the board”: **video_storyboard_attach** → paste `paste_block` (PDF/HTML/SVG) into this chat
- Cast gate locks **character_id** + portrait **`ref_media` / `image_id`** into `video_characters` for reuse across episodes
- **Generate:** `video_characters_ensure_refs` (cast gate also auto-runs) → Content Explorer + Master Data
- **CEO upload:** ask character name → `video_characters_bind_upload` → same Master Data row
- Export after Prompt: CEO Kanban gets HTML + PDF + image with **character_id mapping**; chat attach via `video_storyboard_attach`
- Video gen path (Phase 2): Replicate **`google/veo-*`** via `generate_video` + `Replicate_BYOK`
- If CEO says “story” / “storyboard” / “script”, treat as **your** job via **run video storyboard** — not a handoff
- After storyboard **ceo_approved**: S4 `video_media_generate` (provider `flow_browser` \| `replicate_api`, **≤8s per scene**) → S5 `video_assemble` → status **video_generated**
- Google Flow / Veo cannot do a full story in one shot — always one clip per scene, then assemble
- Flavour 1 needs Desktop Local worker Online (or `video_media_ingest_clip` after CEO download)
- Prefer library faces (`video_characters_list`); Story proposes names → cast gate ensures portraits
- After storyboard: offer “generate clips (Flow or Replicate)” then “assemble final”
- Keep last `storyboard_id` / workflow run id in the reply for follow-ups
- Scheduled goals: feed `recent_titles_90d` into the brief so titles do not repeat
