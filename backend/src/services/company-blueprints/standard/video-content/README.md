# Video content — standard prefabs & workflows

**Source of truth** for the `video_content` industry (short-form / animated video studio).

| Asset | Canonical path | Fix policy |
|-------|----------------|------------|
| Agent workspace MD | `openclaw-workspace-templates/video-orchestrator/` `video-story/` `video-scene/` `video-prompt/` | Edit MD here; Admin refresh / install re-pushes to CEO workspaces |
| Agent grants / ids | `standard/video-content/agents.json` + `packs/video_content.json` | Keep tools/roles in sync with templates |
| Workflow graphs | `standard/video-content/workflow-*.json` | Edit graphs here; re-seed — **no VPS-only hotfixes** |
| Industry Day 0 shape | `packs/video_content.json` | Company setup / Operate |
| Plan | `knowledgebase/VIDEO-CONTENT-GENERATION-PLAN.md` | Product decisions |

## Workflows

| Key | Phrase | Status |
|-----|--------|--------|
| `video-reasoning` | **run video storyboard** | Phase 1 ready (Story→Scene→Prompt→CEO gate) |
| `video-media` | **run video media** | Phase 2 stub (Replicate `google/veo-*`) |
| `video-assembly` | **run video assembly** | Phase 2 stub (FFmpeg + QC) |

Runtime id pattern: `video-{reasoning|media|assembly}-{ownerSlug}`.

## User model

- **Content Orchestrator** = only user-facing chat front door (initiate, review, feedback, finals).
- Story / Scene / Prompt = **workflow nodes** only.

## Seed (when script lands)

```bash
node backend/scripts/seed-video-content-workflows.js
```

Until the seed script exists, graphs remain the template source for Workflow Builder / install code.

## Related

- Pack: `../packs/video_content.json` (repo: `company-blueprints/packs/video_content.json`)
- Blueprint: `knowledgebase/CONTENT-CREATION-ORG-BLUEPRINT.md`
- Social ops (separate): `packs/content_creator.json`
