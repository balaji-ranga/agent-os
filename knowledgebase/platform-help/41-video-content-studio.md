# Video content studio

## What it is

**Video content** is a Flolah industry pack for short-form / cinematic video. You chat with **Content Orchestrator**; specialists (Story, Scene Planner, Prompt) run inside certified workflows — not as separate chat destinations.

Pipeline:

1. **Phase 1 (storyboard)** — Story → CEO cast gate → Scene → Prompt → CEO storyboard gate (PDF/HTML/image)
2. **Phase 2 S4 (clips)** — one clip **per scene**, each **≤ ~8 seconds** (Google Flow / Veo limit)
3. **Phase 2 S5 (assemble)** — FFmpeg + QC → final MP4; story status becomes **`video_generated`**

### S4 flavours

| Flavour | Provider | How |
|---------|----------|-----|
| **1** | `flow_browser` | **Desktop Local** browser worker + Google Flow; **one scene at a time** (serial); bind downloads with `video_media_ingest_clip` |
| **2** | `replicate_api` | Server Replicate `google/veo-*` via `video_media_generate` / vault **`Replicate_BYOK`** |

S5 does **not** call any video model — it only stitches clip files from `video_jobs`.

Social Facebook/LinkedIn posting remains the separate **content_creator** pack.

## CEO quick start

1. Company setup → industry **Video content (shorts / animated / Veo)**, or ask an admin to run the video install for your account.
2. Open chat with **Content Orchestrator** (only front door — do **not** chat Story/Scene/Prompt agents for stories).
3. Ask for a storyboard in plain language (e.g. Thenaliraman for kids, cinematic live-action). Orchestrator first checks **story status / RAG**; if a prior board is still **pending CEO approval**, it asks you to finish that Kanban card before starting a new run.
4. Approve **CEO review: video cast** — confirms `character_id` → name mapping and **portraits** (generated or reused). Cast Summary includes portrait `/api/media/openclaw/…` lines so **Artifacts** can render faces (not WhatsApp-only `MEDIA:` paths).
5. **Upload a character face** (optional): attach an image; Orchestrator asks for the **character name**, then stores it in Master Data `video_characters` (`ref_media` + `image_id`). Prefer upload **before** storyboard so Story cannot invent placeholder refs like `MEDIA:/api/media/<slug>`.
6. Approve **CEO review: video storyboard** — Summary lists scenes + character_ids; **Artifacts** shows cast **portraits** (from Master Data) plus storyboard **PDF / HTML / contact sheet**. Platform prefers library portraits over any invented `ref_media` in agent JSON. Cast + storyboard each write a knowledge row for the same run — approval updates the **export** row (PDF/scenes); the cast-only row is marked superseded.
7. After **`ceo_approved`**, run Phase 2:
   - **run video media** — S4 clips (`flow_browser` or `replicate_api`)
   - **run video assembly** — S5 final MP4 → status **`video_generated`**
8. Paste `MEDIA:` / `/api/media` lines from Orchestrator so Dashboard shows PDF/HTML/video inline.

### Flavour 1 (Google Flow) — Desktop Local sign-in

1. **Connectors** → download **Browser Session package** (full or lite). See help **22**.
2. Run `Start-BrowserWorker.ps1` with `BROWSER_HEADLESS=0` (Chrome channel by default).
3. In the **worker window**, sign into Google / Flow. Cookies live in `BROWSER_USER_DATA_DIR` (default `browser-profile-chrome`). If Google blocks the window, use `Start-ChromeForGoogleLogin.ps1` + `BROWSER_CDP_URL` (help **22**).
4. To use a different profile folder, set `BROWSER_USER_DATA_DIR` in the package `.env` and restart the worker (new folder = sign in again).
5. Confirm **Online** on Connectors, then ask Orchestrator to **run video media** with `provider=flow_browser`.
6. Flow S4 is **serial**: one scene clip, then ingest/complete, then the next `scene_index`. The worker browse is interactive (project → prompt → generate on the current Flow UI). If Google blocks Playwright Chromium, use `Start-ChromeForGoogleLogin.ps1` + `BROWSER_CDP_URL` (help **22**).
7. If a clip downloads outside the tool path, Orchestrator maps it with **`video_media_ingest_clip`** (storyboard_id + scene_index + MEDIA/inbound path).

## Chat phrases

| Phrase | Workflow |
|--------|----------|
| **run video storyboard** | W-Reasoning: Story → cast CEO gate → Scene → Prompt → storyboard CEO gate |
| **run video media** | W-Media S4: per-scene clips (≤8s) |
| **run video assembly** | W-Assembly S5: FFmpeg + QC → `video_generated` |

## Status values (`video_storyboards`)

| Status | Meaning |
|--------|---------|
| `pending_ceo_approval` | Cast or storyboard waiting on Kanban |
| `ceo_approved` | Storyboard approved — ready for S4 |
| `video_generated` | S5 finished; final MP4 stored |
| `rejected` | CEO rejected a gate |

## Master Data (your company only)

| Table | Purpose |
|-------|---------|
| `video_characters` | Reusable cast: `character_id`, name, role, `ref_media`, `image_id`, appearance, series |
| `video_storyboards` | `storyboard_id`, title, **status**, export paths, `final_video_path`, RAG doc id |
| `video_jobs` | Per-scene S4 jobs: provider, prompt, `media_path`, browse/replicate ids (≤8s) |
| `brand_voice` | Tone guidance for story/prompts |

Story details + PDF + final summary are indexed into your **RAG** documents.

## Tools (Orchestrator)

- `video_story_status` — **call first**; pending approval + recent 90-day titles  
- `video_storyboard_attach` — put storyboard PDF/HTML/image into chat (`paste_block`)  
- `agent_workflow_list` / `agent_workflow_enquire` / `agent_workflow_trigger` / `agent_workflow_runs` / `agent_workflow_watch`  
- `video_characters_list` / `video_characters_ensure_refs` / `video_characters_bind_upload` / `video_characters_save`  
- `list_inbound_attachments` — paperclip uploads before bind / clip ingest  
- `video_storyboard_export` — HTML + PDF + SVG + persist + RAG  
- `video_media_generate` — **S4** (`flow_browser` \| `replicate_api`)  
- `video_media_ingest_clip` — Flavour 1: bind downloaded clip to a scene  
- `video_media_jobs` — jobs + asset manifest  
- `video_assemble` — **S5**; sets **`video_generated`**  
- `browse_session_status` / `browse_task_start` / `browse_task_status` — Flavour 1 worker (prefer `video_media_generate`)  
- `generate_video` — low-level Replicate; prefer `video_media_generate` for storyboards  
- `master_data_rag` / `master_data_list_documents`  

**Notifications:** CEO bell on CEO-wait and terminal. Terminal wake prefers **Content Orchestrator**. Knowledge **`agent_workflow_notify_prefs`** can allowlist workflow id patterns.

## Where engineers maintain the golden source

| Asset | Path |
|-------|------|
| Agent MD | `openclaw-workspace-templates/video-orchestrator/` · `video-story/` · `video-scene/` · `video-prompt/` |
| Pack | `backend/src/services/company-blueprints/packs/video_content.json` |
| Workflows | `backend/src/services/company-blueprints/standard/video-content/` |
| Services | `backend/src/services/video-media.js`, `video-assemble.js`, `video-characters.js`, `video-storyboard-export.js` |

Do not hotfix only on the VPS — edit those trees and re-seed / refresh.

## Related

- Plan: [`VIDEO-CONTENT-GENERATION-PLAN.md`](../VIDEO-CONTENT-GENERATION-PLAN.md)  
- Desktop Local: [22-browser-session-and-recipes.md](./22-browser-session-and-recipes.md), [`BROWSER-SESSION-DESKTOP-LOCAL.md`](../BROWSER-SESSION-DESKTOP-LOCAL.md)  
- Blueprint: [`CONTENT-CREATION-ORG-BLUEPRINT.md`](../CONTENT-CREATION-ORG-BLUEPRINT.md)  
- Social ops: [30-content-creator-ops.md](./30-content-creator-ops.md)
