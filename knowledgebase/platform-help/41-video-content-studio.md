# Video content studio (Phase 1 storyboard)

## What it is

**Video content** is a Flolah industry pack for short-form / animated video **storyboards**. You chat with **Content Orchestrator**; specialists (Story, Scene Planner, Prompt) run inside the certified workflow **run video storyboard** — not as separate chat destinations.

Pipeline: **Story → CEO cast gate** (lock reusable `character_id`) → Scene → Prompt → **CEO storyboard gate** (PDF with scenes + character_id map). Phase 1 ends at that approved storyboard. You can paste prompts into Google Flow manually. Phase 2 (later) adds Replicate `google/veo-*` clip generation and assembly.

Social Facebook/LinkedIn posting remains the separate **content_creator** pack.

## CEO quick start

1. Company setup → industry **Video content (shorts / animated / Veo)**, or ask an admin to run the video install for your account.
2. Open chat with **Content Orchestrator** (only front door — do **not** chat Story/Scene/Prompt agents for stories).
3. Ask for a storyboard in plain language (e.g. Thenaliraman for kids, cinematic live-action). Orchestrator first checks **story status / RAG**; if a prior board is still **pending CEO approval**, it asks you to finish that Kanban card before starting a new run.
4. Approve **CEO review: video cast** — confirms `character_id` → name mapping and **portraits** (generated or reused from your library). Cast Summary includes portrait MEDIA lines when available.
5. **Upload a character face** (optional, any time in chat): attach an image; Orchestrator asks for the **character name**, then stores it in Master Data `video_characters` (`ref_media` + `image_id`) under Content Explorer for reuse.
6. Approve **CEO review: video storyboard** — Summary lists scenes + character_ids; **Artifacts** shows the storyboard **PDF** (roster + scenes + prompts).
7. Open exported **HTML / PDF / SVG** from that card, chat `MEDIA:` links, or Content Explorer.
8. Optionally copy Veo/Flow prompts into Google Flow for a manual test.

## Chat phrase

| Phrase | Workflow |
|--------|----------|
| **run video storyboard** | W-Reasoning: Story → cast CEO gate → Scene → Prompt → storyboard CEO gate |

## Master Data (your company only)

| Table | Purpose |
|-------|---------|
| `video_characters` | Reusable cast: `character_id`, name, role, `ref_media`, `image_id`, appearance, series |
| `video_storyboards` | `storyboard_id`, title, **status** (`pending_ceo_approval` / `ceo_approved` / `video_generated`), workflow_run_id, export paths, RAG doc id |
| `video_jobs` | Reserved for Phase 2 clip jobs |
| `brand_voice` | Tone guidance for story/prompts |

Story details + PDF are also indexed into your **RAG** documents so Orchestrator can recall titles and status.

## Tools (Orchestrator)

- `video_story_status` — **call first**; pending approval + recent 90-day titles  
- `video_storyboard_attach` — **required** to put final PDF/HTML/image into chat (`paste_block`)  
- `agent_workflow_list` / `agent_workflow_enquire` — find published video workflows  
- `agent_workflow_trigger` — start W-Reasoning (`run video storyboard`)  
- `agent_workflow_runs` / `agent_workflow_watch` — check run status / notify on terminal  
- `video_characters_list` — library + which faces are missing images  
- `video_characters_ensure_refs` — **generate** (or reuse) portraits → Content Explorer + Master Data  
- `video_characters_bind_upload` — **CEO upload** → ask character name → map + store in Master Data  
- `list_inbound_attachments` — find paperclip uploads before bind  
- `video_characters_save` — metadata-only upsert (no image generate)  
- `video_storyboard_export` — HTML + PDF + SVG + persist row + RAG  
- `master_data_rag` / `master_data_list_documents` — knowledge / RAG  

After approval (or when you ask to see the board), Orchestrator pastes `MEDIA:` / `/api/media` lines so **Dashboard chat** shows the PDF/HTML/SVG inline (open + download).

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
