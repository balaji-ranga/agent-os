# Video Tours — local working tree

CEO-centric clips (<= 1 min each). Curriculum: [../VIDEO-TOURS-CEO-CURRICULUM.md](../VIDEO-TOURS-CEO-CURRICULUM.md).

| Path | Purpose |
|------|---------|
| `playlist.json` | Catalog served by `/api/video-tours` |
| `scripts/*.md` | Voice script + shot list |
| `scripts/*.vtt` | Sidecar captions draft |
| `assets/*.mp4` | Walkthrough videos (UI mock slides + pointer callouts + Piper TTS) |

**In app:** User icon → **Help → Video Tours** (`/video-tours`).

Videos are **navigational walkthroughs**: each clip advances through FloLah UI mock frames (left nav highlight, scene panels, orange pointer callouts) timed to the voice track — not a static title card.

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