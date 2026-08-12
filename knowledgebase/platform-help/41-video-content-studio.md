# Video content studio (Phase 1 storyboard)

## What it is

**Video content** is a Flolah industry pack for short-form / animated video **storyboards**. You chat with **Content Orchestrator**; specialists (Story, Scene Planner, Prompt) run inside the certified workflow **run video storyboard** — not as separate chat destinations.

Pipeline: **Story → CEO cast gate** → Scene → Prompt → **CEO storyboard gate** → (Phase 2) **S4 scene clips ≤8s** → **S5 FFmpeg assemble** → status **`video_generated`**.

Phase 1 ends at the approved storyboard. Phase 2 clip producers:

| Flavour | Provider | How |
|---------|----------|-----|
| **1** | `flow_browser` | Desktop Local `browse_*` / Google Flow (CEO login); ingest downloads with `video_media_ingest_clip` |
| **2** | `replicate_api` | Server Replicate `google/veo-*` via `video_media_generate` / BYOK |

**Important:** Google Flow / Veo generate **at most ~8 seconds per clip**. Each storyboard scene is generated separately, then S5 stitches them. S5 does **not** call any video model.

Social Facebook/LinkedIn posting remains the separate **content_creator** pack.

## CEO quick start

1. Company setup → industry **Video content (shorts / animated / Veo)**, or ask an admin to run the video install for your account.
2. Open chat with **Content Orchestrator** (only front door — do **not** chat Story/Scene/Prompt agents for stories).
3. Ask for a storyboard in plain language (e.g. Thenaliraman for kids, cinematic live-action). Orchestrator first checks **story status / RAG**; if a prior board is still **pending CEO approval**, it asks you to finish that Kanban card before starting a new run.
4. Approve **CEO review: video cast** — confirms `character_id` → name mapping and **portraits** (generated or reused from your library). Cast Summary includes portrait MEDIA lines when available.
5. **Upload a character face** (optional, any time in chat): attach an image; Orchestrator asks for the **character name**, then stores it in Master Data `video_characters` (`ref_media` + `image_id`) under Content Explorer for reuse.
6. Approve **CEO review: video storyboard** — Summary lists scenes + character_ids; **Artifacts** shows the storyboard **PDF** (roster + scenes + prompts).
7. Open exported **HTML / PDF / SVG** from that card, chat `MEDIA:` links, or Content Explorer.
8. Optionally copy Veo/Flow prompts into Google Flow for a manual test — or run Phase 2:
   - **run video media** / `video_media_generate` (`flow_browser` or `replicate_api`) — **one ≤8s clip per scene**
   - **run video assembly** / `video_assemble` — final MP4; status becomes **`video_generated`**

## Chat phrases

| Phrase | Workflow |
|--------|----------|
| **run video storyboard** | W-Reasoning: Story → cast CEO gate → Scene → Prompt → storyboard CEO gate |
| **run video media** | W-Media S4: per-scene clips (≤8s) |
| **run video assembly** | W-Assembly S5: FFmpeg + QC → `video_generated` |

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

**Notifications (by design):** On CEO-wait and terminal, the **CEO bell** always gets a platform notification. Terminal **wake** goes to the **triggering orchestrator** — usually **Content Orchestrator** when they started `run video storyboard` (so they can attach/present exports). Limit which workflows wake an agent via Knowledge **`agent_workflow_notify_prefs`** (no rows = all; rows = allowlist, e.g. `video-reasoning*`). COO is **not** meant to re-fire Daily Status Digest from a video completion; unbound video wakes prefer Content Orchestrator and stay status-only.
- `video_characters_list` — library + which faces are missing images  
- `video_characters_ensure_refs` — **generate** (or reuse) portraits → Content Explorer + Master Data  
- `video_characters_bind_upload` — **CEO upload** → ask character name → map + store in Master Data  
- `list_inbound_attachments` — find paperclip uploads before bind  
- `video_characters_save` — metadata-only upsert (no image generate)  
- `video_storyboard_export` — HTML + PDF + SVG + persist row + RAG  
- `video_media_generate` — **S4** clips (≤8s/scene); `provider=flow_browser` \| `replicate_api`  
- `video_media_ingest_clip` — Flavour 1: bind Flow download to a scene  
- `video_media_jobs` — job list + asset manifest  
- `video_assemble` — **S5** FFmpeg + QC → final MP4; sets **`video_generated`**  
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
