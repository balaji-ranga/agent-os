# CEO Video Tours — curriculum (max 12)

**Product surface:** User menu → **Help → Video Tours** (`/video-tours`) + link from Platform Help chat / Onboarding done.  
**Local working copy:** `knowledgebase/video-tours/` (scripts, captions, exported mp4).  
**VPS later:** Platform Help assets under Master Data / help corpus (same filenames).  
**Constraint:** Each clip <= 60 seconds. CEO-user centric. Captions: sidecar `.vtt` (recommended).

**Related:** [CONTENT-CREATION-ORG-BLUEPRINT.md](./CONTENT-CREATION-ORG-BLUEPRINT.md) (final tour + future org).

---

## Recording decision (locked)

**Approach: lighter alternative**

| Clips | Production |
|-------|------------|
| **All 12** (current) | **UI walkthrough mp4s**: curated FloLah shell slides (nav highlight + orange pointer callouts) + Piper TTS + sidecar `.vtt` |
| **01 / 12** (optional later) | Replace with real Flolah screen recordings when ready |

**VO:** Scripts in `video-tours/scripts/`; export via `backend/scripts/export-video-tours.js` (storyboards in `video-tours-storyboards.js`).  
**Captions:** Sidecar `.vtt`. Exported assets live under `/data/agent-os/video-tours/assets` (mirrored in repo `knowledgebase/video-tours/assets`).

---

## Playlist order (12)

| # | File stem | Title | Goal |
|---|-----------|-------|------|
| 01 | `01-vision-architecture` | Vision, purpose, architecture | Why FloLah; high-level map; brief feature tour |
| 02 | `02-first-login-profile` | First login & Profile | MFA, Profile, where Onboarding Helper will live |
| 03 | `03-org-dashboard-agents` | Org, agents & chat | Org chart, chat, attachments, Resync |
| 04 | `04-coo-kanban-standups` | COO, Kanban & standups | Day-to-day ops loop |
| 05 | `05-workflows-builder` | Workflows & Workflow Builder | Create, publish, run; certify mention |
| 06 | `06-master-data-rag` | Master Data & RAG | Docs/tables; Platform Help corpus |
| 07 | `07-tools-api-keys` | Tools & API Keys | Vault BYOK; content tools; MEDIA: habit |
| 08 | `08-channels-whatsapp` | Agent channels (WhatsApp) | Connect WA; inbound attachments; outbound MEDIA: |
| 09 | `09-browser-content-explorer` | Browser Session & Content Explorer | Recipes + where uploads/generated land |
| 10 | `10-efficiency-budgets` | Efficiency, budgets & retention | Token/error budgets; storage; purge |
| 11 | `11-avatars-scenes-speech` | Avatars, Published Scenes & speech | VR/public slug; STT/TTS briefly |
| 12 | `12-efficient-org-content-studio` | Efficient org — content studio | End-state using content-creation blueprint |

Scripts live in `video-tours/scripts/`. Captions: same stem `.vtt`. Exports: `video-tours/assets/*.mp4`.

---

## Production checklist (per video)

1. Approve voice script (~130–150 spoken words max for 60s).  
2. Shot list: 4–6 UI beats on https://flolah.cloud (or storyboard stills).  
3. Record/generate VO + burn or sidecar captions.  
4. Export 1080p mp4 <= 60s, <= ~15 MB preferred.  
5. Drop into `assets/` locally; sync to Platform Help Video Tours when player ships.

---

## Platform Help index note

When the player ships, add a row in `platform-help/README.md` pointing to Video Tours (not each long script). Keep these curriculum files under `knowledgebase/` (outside platform-help) so RAG does not ingest full scripts unless we deliberately upload a short index doc.
