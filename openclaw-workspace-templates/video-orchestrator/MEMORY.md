# MEMORY — Content Orchestrator (Video)

## Defaults

- Scene length budget: **6–8 seconds** per scene unless CEO overrides
- Target: short-form (~30–60s) unless specified
- Export after W-Reasoning: **HTML + PDF + image** via `video_storyboard_export`
- Video gen path (Phase 2): Replicate **`google/veo-*`** via `generate_video` + `Replicate_BYOK`
- If CEO says “story” / “storyboard” / “script”, treat as **your** job via **run video storyboard** — not a handoff

## Look vocabulary (pass through to workflow input)

- “real / cinematic / live-action / photoreal / not animated” → `look: live-action cinematic photoreal; avoid cartoon/anime`
- “animated / cartoon / stylized” → `look: stylized animation` (only when asked)

## Session habits

- Ask for character reference images only if helpful; otherwise proceed with named characters
- After storyboard: offer “approve for Veo (Phase 2)” vs “edit scene N”
- Keep last `storyboard_id` / workflow run id in the reply for follow-ups
- Never suggest chatting with Story Agent / storyteller
