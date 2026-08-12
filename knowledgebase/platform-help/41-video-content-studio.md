# Video content studio (Phase 1 storyboard)

## What it is

**Video content** is a Flolah industry pack for short-form / animated video **storyboards**. You chat with **Content Orchestrator**; specialists (Story, Scene Planner, Prompt) run inside the certified workflow **run video storyboard** — not as separate chat destinations.

Phase 1 ends at a complete storyboard (prompts + character refs) plus **HTML / PDF / image** exports you can open from chat or **Content Explorer**. You can paste prompts into Google Flow manually. Phase 2 (later) adds Replicate `google/veo-*` clip generation and assembly.

Social Facebook/LinkedIn posting remains the separate **content_creator** pack.

## CEO quick start

1. Company setup → industry **Video content (shorts / animated / Veo)**, or ask an admin to run the video install for your account.
2. Open chat with **Content Orchestrator**.
3. Attach character reference images (or describe characters).
4. Ask for a storyboard (e.g. a 60-second fable). Orchestrator triggers **run video storyboard**.
5. Review the board; ask for edits (“change scene 4”).
6. Open exported **HTML / PDF / SVG** via `MEDIA:` links or Content Explorer.
7. Optionally copy Veo/Flow prompts into Google Flow for a manual test.

## Chat phrase

| Phrase | Workflow |
|--------|----------|
| **run video storyboard** | W-Reasoning: Story → Scene → Prompt → CEO gate |

## Master Data (your company only)

| Table | Purpose |
|-------|---------|
| `video_characters` | Character name, role, ref media paths |
| `video_storyboards` | Saved plans + export paths |
| `video_jobs` | Reserved for Phase 2 clip jobs |
| `brand_voice` | Tone guidance for story/prompts |

## Tools (Orchestrator)

- `agent_workflow_trigger` — start W-Reasoning  
- `video_characters_save` — store character refs  
- `video_storyboard_export` — HTML + PDF + SVG + persist row  
- `generate_image` — optional extra visual  

All are **owner-scoped** to your CEO login. Agents you are not granted cannot use your tables or media.

## Where engineers maintain the golden source

| Asset | Path |
|-------|------|
| Agent MD | `openclaw-workspace-templates/video-orchestrator/` · `video-story/` · `video-scene/` · `video-prompt/` |
| Pack | `backend/src/services/company-blueprints/packs/video_content.json` |
| Workflows | `backend/src/services/company-blueprints/standard/video-content/` |

Do not hotfix only on the VPS — edit those trees and re-seed / refresh.

## Related

- Plan: [`VIDEO-CONTENT-GENERATION-PLAN.md`](../VIDEO-CONTENT-GENERATION-PLAN.md)  
- Blueprint: [`CONTENT-CREATION-ORG-BLUEPRINT.md`](../CONTENT-CREATION-ORG-BLUEPRINT.md)  
- Social ops: [30-content-creator-ops.md](./30-content-creator-ops.md)
