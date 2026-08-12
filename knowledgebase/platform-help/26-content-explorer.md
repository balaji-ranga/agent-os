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

Each row shows filename, kind (doc / image / audio / video), size, and optional channel. Use search to filter by name or path on the **current page**. The list is **server-paged** (50 per page) — use **Prev** / **Next** when you have more files than fit on one page.

## Preview, download, and delete

- Click **View** to **preview** in the browser when possible:
  - **Images** including **SVG**
  - **PDF** (embedded viewer)
  - **HTML** storyboards / pages (sandboxed)
  - **Text** (`.txt`, `.md`, `.csv`, `.json`, …)
  - **Audio** / **video**
- Other types still offer **Download**.
- Downloads use your logged-in session — files are **not** world-public.
- Select rows → **Delete selected**, or **Delete all** (respects the Uploaded/Generated/All filter).
- Delete is a **hard delete from disk** (workspace inbound + workflow-fs mirror for uploads; `media/generated/<you>/` for generated). There is **no** recycle bin or tmp staging.

## Retention

Profile **Data persistence** (default 90 days) also hard-deletes aged Content Explorer files by **file mtime** on the nightly retention job — same window as chat/workflow history. Master Data documents are still **not** purged by retention (use Master Data purge for those).

## WhatsApp / OpenClaw staging

Channel media is mirrored into **Uploaded** (inbound/attachments/). Once mirrored, Agent OS **removes** the temporary OpenClaw file under `~/.openclaw/media/inbound/`. Clean space from Content Explorer (delete here); staging will not keep re-creating files after delete (ledger suppresses remirror).

## Related places

| Place | Role |
|-------|------|
| **Master Data → Inbound attachments** | Same inbound folder; **Index to RAG** for text/PDF/Office docs |
| **Agent Chat** paperclip | Writes into Master Data + `inbound/attachments/` (then appears here) |
| **Agent Channels** | WhatsApp/Slack inbound → `inbound/attachments/` ([24-agent-channels.md](./24-agent-channels.md)) |
| **Efficiency View → Org** | **Storage (MB)** includes tenant workspace + `media/generated/<you>/` + Master Data docs/files + OpenSearch RAG indices (click **i** for breakdown) |
| **Tools / chat inline media** | Generated media also plays in chat when you are logged in ([11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md)) |

## Ops notes

- Paths are constrained by `WORKFLOW_FS_ROOTS` (compose typically includes `/data/workflow-fs`, OpenClaw `tenants`, and `media`).
- API: `GET /api/workspace/content-explorer`, download, `POST /api/workspace/content-explorer/delete` (CEO entitlement / auth required).

Ask **Platform Help**: "How do I browse my uploaded files?" or "How do I delete Content Explorer media?"