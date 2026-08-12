# Video content generation — implementation plan

**Status:** Approved design (not shipped).  
**Product:** Flolah / Agent OS  
**Related:** [CONTENT-CREATION-ORG-BLUEPRINT.md](./CONTENT-CREATION-ORG-BLUEPRINT.md), [platform-help/30-content-creator-ops.md](./platform-help/30-content-creator-ops.md) (social ops — separate pack)  
**Source requirements:** CEO demo journey (Phase 1 storyboard → manual Google Flow; Phase 2 Veo → edit → QC → final)

---

## Locked decisions

| # | Decision |
|---|----------|
| 1 | **New pack** `video_content` (separate from social `content_creator`) |
| 2 | **Veo via Replicate** `google/veo-*` using existing `generate_video` / vault `Replicate_BYOK` / Tools→Model |
| 3 | **Specialists run inside Workflows**; **Content Orchestrator** is the chat front door for initiate, review, feedback, and final results |
| 4 | Storyboard export in **S3**: HTML + PDF + image (not markdown-only) |

---

## Canonical source of truth (maintain here)

Fixes and improvements **must** land in these trees, then re-seed / Admin refresh — not as one-off VPS hotfixes.

| Asset | Path |
|-------|------|
| Agent workspace MD | `openclaw-workspace-templates/video-orchestrator/` · `video-story/` · `video-scene/` · `video-prompt/` |
| Industry Day 0 pack | `backend/src/services/company-blueprints/packs/video_content.json` |
| Standard agents / workflows | `backend/src/services/company-blueprints/standard/video-content/` (`agents.json`, `workflow-*.json`, `workflows-manifest.json`, `README.md`) |
| Catalog index | `backend/src/services/company-blueprints/standard/catalog.json` → `video_content` |
| Industry card | `backend/src/services/company-blueprints/industries.json` → `video_content` |

**Orchestrator** = user-facing. **Story / Scene / Prompt** = workflow nodes only (templates still live under `openclaw-workspace-templates/` so graph agent nodes get consistent SOUL/TOOLS).

---

## Product shape

| Phase | User experience | Behind the scenes |
|-------|-----------------|-------------------|
| **1 — Storyboard MVP** | Chat with Content Orchestrator → characters + story + scenes + Veo/Flow prompts → storyboard in same chat (HTML/PDF/image) → manual Google Flow test | W-Reasoning: Story → Scene Planner → Prompt agents |
| **2 — Automated production** | Same chat: approve / “change scene 4” / regenerate → clips → assemble → QC → final MP4 | W-Media (Replicate Veo) → W-Assembly (FFmpeg + QC) |

```text
User ↔ Content Orchestrator (chat only)
         │
         ├─ agent_workflow_trigger → W-Reasoning → storyboard JSON
         │                              └─ Orchestrator renders HTML/PDF/image + MEDIA: in chat
         │
         ├─ (Phase 1) User copies prompts → Google Flow (manual)
         │
         └─ (Phase 2) approve → W-Media (generate_video google/veo-*)
                              → W-Assembly (FFmpeg + QC)
                              → final MP4 in Content Explorer + chat summary
```

**Orchestrator responsibilities:** start runs, present storyboard/results, collect CEO feedback, re-trigger regen/approve workflows, surface finals.  
**Orchestrator does not:** run Story/Scene/Prompt as inline multi-agent chat; those are workflow nodes/agents.

---

## Reuse (no greenfield studio UI)

| Need | Existing surface |
|------|------------------|
| Front door | Agent Chat (`ChatMessageContent`, attachments, `MEDIA:`) |
| Character refs | Chat upload, Avatars, Content Explorer → `media/generated/<ceo>/` |
| Clip gen (P2) | `POST /tools/generate-video`, `getVideoConfig`, Tools→Model → Replicate `google/veo-*` |
| Voice / captions (P2) | `speech_tts` / `speech_stt`, ElevenLabs workflow nodes |
| Durable plan | Master Data + Kanban artifacts |
| Orchestration | Workflow Builder + `agent_workflow_trigger` |
| Approvals | Kanban waiting-you |
| Org install | Company Setup / Operate → **`video_content` pack** |

**Out of scope for MVP UI:** separate storyboard SPA; Video Tours as product studio; Virtual Room as primary editor; native Gemini OpenAI `/v1/videos` (may add later; Phase 2 is Replicate first).

---

## Phase 1 — Content Orchestrator + Storyboard MVP

### Org (`video_content` pack)

| Agent | User-facing? | Role |
|-------|--------------|------|
| **Content Orchestrator** | Yes | Intake, trigger W-Reasoning / later W-Media, present exports, feedback loop |
| Story Agent | Workflow-only | Storyline around selected characters |
| Scene Planner | Workflow-only | 6–8s scene cards + character assignment |
| Prompt Agent | Workflow-only | Flow/Veo-ready prompts per scene |

### Character setup

- **Generate:** after Story names cast (cast gate / `video_characters_ensure_refs`) create portraits → Content Explorer `media/generated/<ceo>/` → Master Data `video_characters` (`character_id`, `ref_media`, `image_id`, appearance).
- **CEO upload:** Orchestrator asks for **character name**, then `video_characters_bind_upload` maps inbound/MEDIA path into the same Master Data row.
- List/reuse via `video_characters_list`; metadata-only upsert via `video_characters_save`.
- Persist: name, role, reference media path + image_id in Master Data `video_characters` (CEO-scoped).

### Storyboard contract

Stable JSON (also used for exports), e.g. title, duration, characters[], scenes[{ index, duration_sec, characters, description, veo_prompt, negative_prompt, continuity_notes }].

### S3 exports (required)

From chat / Orchestrator tools after W-Reasoning:

1. **HTML** storyboard page  
2. **PDF** export  
3. **Image** (storyboard grid / contact sheet via `generate_image` or HTML→screenshot)

Store under Content Explorer (`media/generated/<ceo>/…`); return `MEDIA:` links in the same Orchestrator chat.

### Phase 1 acceptance

- Prompt like “60s video of these two characters at an Indian wedding” + refs → storyboard with N scenes in **same chat**, plus HTML/PDF/image artifacts.  
- User can manually test prompts in Google Flow.  
- No separate storyboard application.

---

## Phase 2 — Automated video production

**Clip budget:** Google Flow / Veo produce **≤ ~8 seconds per generation**. S4 therefore generates **one clip per scene** (scene `duration_sec` capped at 8), never a single long render for the whole story. S5 concatenates those clips.

### S4 providers (two flavours)

| Flavour | `provider` | Mechanism |
|---------|------------|-----------|
| **1** | `flow_browser` | Desktop Local browser worker + Google Flow UI; durable ingest via `video_media_ingest_clip` |
| **2** | `replicate_api` | `generate_video` / Replicate `google/veo-*` + vault `Replicate_BYOK` / Tools→Model |

Shared: Master Data `video_jobs` (paths only) + asset manifest.

### S5 (shared — no video model)

1. QC manifest (all scenes have readable clips, duration ≤8s).  
2. FFmpeg normalize + concat → final MP4 under Content Explorer.  
3. Set `video_storyboards.status` = **`video_generated`**; RAG index final summary; Orchestrator pastes `MEDIA:`.

### Phase 2 acceptance

- Approved storyboard → per-scene clips → stitched preview in Explorer.  
- “Regenerate scene N” replaces one clip and reassembles.  
- Final MP4 playable via existing media / `MEDIA:` cards.  
- Status after S5 is **`video_generated`**.

---

## Delivery slices

| Slice | Scope |
|-------|--------|
| **S0** | This plan + blueprint + scaffold templates/pack/standard | **Done** |
| **S1** | Seed/install agents + publish **W-Reasoning** from `standard/video-content/` | **Done** |
| **S2** | Characters Master Data + save/list + **ensure_refs** + **bind_upload** | **Done** |
| **S3** | Storyboard **HTML/PDF/image**; cast + storyboard CEO gates; status + RAG | **Done** |
| **S4** | Dual flavour scene jobs ≤8s: `flow_browser` + `replicate_api` (`workflow-media.json`) | **Done** |
| **S5** | FFmpeg + `workflow-assembly.json` + QC; mark **`video_generated`** | **Done** |
| **S6** | README/help/.env.example, local + VPS deploy, Operate readiness | Partial (help 41 + KB) |

---

## Auth, BYOK, entitlements

1. All new routes/tools: authenticated + CEO owner scope (`resolveToolOwnerUserId` / CEO helpers). Never trust body `ceo_user_id` for auth.  
2. Video: platform Replicate token **or** vault `Replicate_BYOK`; per-tool model override for `generate_video`.  
3. Agent grants + allowlists for Orchestrator and workflow-invoked tools.  
4. Logs: redact secrets; store media **paths**, not raw bytes in workflow step payloads.

---

## Non-goals (near term)

- Browser timeline NLE  
- Merging into `content_creator` social publish pack  
- Video Tours as CEO video studio  
- YouTube/IG native upload (post-P2)  
- Native Gemini OpenAI videos API as primary (Replicate Veo first)

---

## Changelog

| Date | Note |
|------|------|
| 2026-08-12 | Plan drafted from demo.docx; decisions locked (new pack, Replicate Veo, workflow specialists, HTML/PDF/image in S3). |
| 2026-08-12 | Scaffolded `openclaw-workspace-templates/video-*` + `packs/video_content.json` + `standard/video-content/`; maintenance must stay in those trees. |
| 2026-08-12 | S4 dual flavour (`flow_browser` \| `replicate_api`) + S5 FFmpeg; ≤8s/scene; status `video_generated` after assemble. |
| 2026-08-12 | S1–S3 harden: Story→CEO cast→Scene→Prompt→CEO storyboard; `video_storyboards.status` + RAG; PDF character_id roster; `video_story_status` blocks pending approvals. |
