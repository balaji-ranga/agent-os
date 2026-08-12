# Content creation org — FloLah blueprint

**Status:** Design blueprint (product agents/workflows land via [VIDEO-CONTENT-GENERATION-PLAN.md](./VIDEO-CONTENT-GENERATION-PLAN.md)).  
**Used by:** CEO Video Tour ("Efficient org — video content studio"), Onboarding Helper recommendations, eng implementation.  
**Audience:** Product / eng; CEOs via tour script.

---

## Vision

A CEO whose business is **animated / short-form video content** runs FloLah as an OS: strategy and approvals stay with the human; agents and workflows turn a prompt into a storyboard (Phase 1) and published video with QC (Phase 2).

**Pack:** `video_content` (separate from social `content_creator`).  
**Front door:** Content Orchestrator in Agent Chat.  
**Specialists:** Story / Scene / Prompt (and later media/assembly roles) run **inside certified workflows**, not as separate user-facing chats.

### Maintain in code (not ad-hoc)

| Kind | Path |
|------|------|
| Templates | `openclaw-workspace-templates/video-orchestrator\|video-story\|video-scene\|video-prompt/` |
| Pack | `backend/src/services/company-blueprints/packs/video_content.json` |
| Standard workflows / agents | `backend/src/services/company-blueprints/standard/video-content/` |

See [VIDEO-CONTENT-GENERATION-PLAN.md](./VIDEO-CONTENT-GENERATION-PLAN.md).

---

## Pipeline (canonical)

```text
User Prompt
      |
      v
---------------
Reasoning Pipeline   (W-Reasoning)
---------------
Story Agent
      |
Scene Agent
      |
Prompt Agent
      |
Review / CEO gate
      |
      v
Production Plan + storyboard exports (HTML / PDF / image)
      |
      v
--------------------
Media Pipeline       (W-Media — Phase 2)
--------------------
Character / Environment (cache)
      |
Video Agent (Replicate google/veo-* via generate_video)
 ├── Voice Agent
 ├── Music Agent (optional)
 └── Subtitle Agent
      |
      v
Media Assets (paths under media/generated/{ceo}/)
      |
      v
--------------------
Assembly Pipeline    (W-Assembly — Phase 2)
--------------------
Editor (FFmpeg) → QC → Publisher (later)
      |
      v
Final Video → Content Explorer / channels
```

---

## Map to FloLah

| Pipeline role | FloLah placement | Tools / surfaces | Notes |
|---------------|------------------|------------------|--------|
| **Content Orchestrator** | User-facing AI employee | Chat, `agent_workflow_trigger`, notify/Kanban | Initiate, review, feedback, finals |
| **Story Agent** | Workflow node / specialty | Brain + Master Data | Narrative beats |
| **Scene Agent** | Workflow | Workflow + Brain | 6–8s scene cards |
| **Prompt Agent** | Workflow | Prompt tools, BYOK | Veo/Flow-ready prompts |
| **Review / CEO gate** | Kanban + Orchestrator | Certify / waiting-you | Before media spend |
| **Production plan** | Master Data + Kanban artifacts | Paths + JSON only | Durable storyboard |
| **Character / Environment** | Avatars, Explorer, image gen | Cache refs | Prefer cache hits |
| **Video Agent** | `generate_video` | Replicate `google/veo-*`, `Replicate_BYOK` | Async jobs |
| **Voice / Subtitle** | speech_tts / speech_stt | Piper/Whisper, ElevenLabs | Sidecar then mux |
| **Editor / QC** | W-Assembly | FFmpeg worker | No base64 in steps |
| **Publisher** | Later Growth specialty | Connectors / future YouTube | After QC |

**COO:** Delegation and budgets — not every frame.  
**Workflow Builder:** Authors/certifies W-Reasoning / W-Media / W-Assembly.  
**Do not** use Platform Help Video Tours as the product video studio.

---

## Suggested org chart (example)

```text
CEO
 └── COO
      ├── Creative — Orchestrator (user-facing), Story, Scene, Prompt, Review
      ├── Production — Character, Environment, Video, Voice, Music, Subtitle
      ├── Assembly — Editor, QC
      └── Growth — Publisher + analytics (later)
```

---

## Workflows (minimal set)

1. **W-Reasoning** — brief → Story → Scene → Prompt → Review → `production_plan.json` + HTML/PDF/image exports  
2. **W-Media** — plan id → cache assets → Video (Veo) → Voice/Music/Subtitle → asset manifest  
3. **W-Assembly** — manifest → FFmpeg → QC → final URL + Content Explorer  

Interlocks: no W-Media without storyboard approval; no Publisher without QC; retention respects CEO `data_retention_days`.

---

## What not to store

- No full base64 video in `agent_workflow_run_steps` (paths + manifests only).  
- Bytes under `media/generated/{ceo}/` or inbound attachments.  
- Platform credentials only in API Keys vault / Connectors.

---

## Relation to Onboarding Helper / social ops

- Video business → propose `video_content` chart/workflows; apply only after UI confirmation.  
- Social text/image publish remains **`content_creator`** ([platform-help/30-content-creator-ops.md](./platform-help/30-content-creator-ops.md)).

---

## Implementation tracker

See **[VIDEO-CONTENT-GENERATION-PLAN.md](./VIDEO-CONTENT-GENERATION-PLAN.md)** for locked decisions and slices S0–S6.
