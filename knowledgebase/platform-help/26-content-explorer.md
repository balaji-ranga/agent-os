# Content Explorer (file browser)

Browse **your** uploaded and generated files in one place — chat attachments, channel inbound media, and tool-generated image/audio/video.

## Open it

**Management → Content Explorer** → `/content-explorer` (also linked from the left nav).

## What you see

| Filter | Contents |
|--------|----------|
| **All** | Uploaded + generated |
| **Uploaded** | Chat paperclip files, WhatsApp/Slack inbound mirrored under `inbound/attachments/`, Master Data–related uploads |
| **Generated** | Images / audio / video produced by content tools (e.g. `generate_image`, speech TTS) for your tenant |

Each row shows filename, kind (doc / image / audio / video), size, and optional channel. Use search to filter by name or path.

## Preview and download

- Click a row to **preview** when the browser can play it (image / audio / video).
- Downloads use your logged-in session (`/api/workspace/content-explorer/download…`) — files are **not** world-public.

## Related places

| Place | Role |
|-------|------|
| **Master Data → Inbound attachments** | Same inbound folder; **Index to RAG** for text/PDF/Office docs |
| **Agent Chat** paperclip | Writes into Master Data + `inbound/attachments/` (then appears here) |
| **Agent Channels** | WhatsApp/Slack inbound → `inbound/attachments/` ([24-agent-channels.md](./24-agent-channels.md)) |
| **Tools / chat inline media** | Generated media also plays in chat when you are logged in ([11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md)) |

## Ops notes

- Paths are constrained by `WORKFLOW_FS_ROOTS` (compose typically includes `/data/workflow-fs`, OpenClaw `tenants`, and `media`).
- API: `GET /api/workspace/content-explorer`, `GET /api/workspace/content-explorer/download` (CEO entitlement / auth required).

Ask **Platform Help**: "How do I browse my uploaded files?" or "Where is Content Explorer?"