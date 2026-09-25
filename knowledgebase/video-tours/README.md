# Video Tours — local working tree

CEO-centric clips (normally <= 1 min each) plus explicitly identified featured demonstrations. Curriculum: [../VIDEO-TOURS-CEO-CURRICULUM.md](../VIDEO-TOURS-CEO-CURRICULUM.md).

| Path | Purpose |
|------|---------|
| `playlist.json` | Catalog served by `/api/video-tours` |
| `scripts/*.md` | Voice script + shot list |
| `scripts/*.vtt` | Sidecar captions draft |
| `assets/*.mp4` | Walkthrough videos (UI mock slides + pointer callouts + Piper TTS) |

**In app:** User icon → **Help → Video Tours** (`/video-tours`).

Videos are **navigational walkthroughs**: each clip advances through FloLah UI mock frames (left nav highlight, scene panels, orange pointer callouts) timed to the voice track — not a static title card.

`13-northstar-ai-native-company` is a featured 6–7 minute live-product recording. It uses a short-lived, non-impersonated CEO session, performs read-only navigation, verifies that no Admin impersonation banner is present, and revokes the capture session after production. The recording must show the four active scheduled goals, 12 ERPNext CRM opportunities, and three ERPNext Sales Invoices created by the Northstar seed pack. Its reusable capture/render harness is `backend/scripts/northstar-demo-video.mjs`.

Generate it on the VPS without rebuilding or restarting services:

```bash
cd /opt/agent-os
bash deploy/scripts/vps-generate-northstar-demo.sh
```

The helper runs the isolated seed lifecycle and ERPNext company/session isolation gates before capture, performs focused file copies into the running browser and backend containers, validates the rendered artifact, stores no credentials in the repository, and does not read or modify `deploy/.env`.

**Re-export on VPS** (after script or storyboard edits):

```bash
cd /opt/agent-os/deploy
docker compose exec -T -e SPEECH_TTS_URL=http://piper:5500 -e FORCE=1 -w /opt/agent-os/backend \
  backend node scripts/export-video-tours.js
```

Storyboards: `backend/scripts/video-tours-storyboards.js`  
Slide SVG renderer: `backend/scripts/video-tours-render-slides.js`

Persistent path: `/data/agent-os/video-tours/assets` (also mirrored under `knowledgebase/video-tours/assets`).
PNG slide cache: `/data/agent-os/video-tours/slides/<stem>/`.
