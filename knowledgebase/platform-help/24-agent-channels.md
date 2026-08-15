# Agent channels (Slack / WhatsApp)

**Audience:** CEOs enabling Slack or WhatsApp for an org agent; ops installing gateway plugins.

## What it does

Per-CEO **bring-your-own-key (BYOK)** channel enablement. You paste Slack tokens (or scan a WhatsApp QR) in a Dashboard wizard. Agent OS stores secrets in your **API Keys** vault and patches the shared gateway with tenant-scoped `channels` + `bindings` for `t-{ceo}--{agent}`.

Telegram / Discord are not in V1 (wizard may show “coming soon”).

## Deploy / ops (no config drift)

Channel routing is re-applied automatically so recreating AgentSystem does not drop WhatsApp/Slack:

1. **DB** (`ceo_agent_channels`) is source of truth for enabled/pairing channels.  
2. **Sidecar** `~/.openclaw/agent-os-channel-routing.json` snapshots `channels` + `bindings`.  
3. **configure-openclaw-docker.js** / **apply-openclaw-agents-config.js** restore from the sidecar if `openclaw.json` lost routing.  
4. **openclaw-entrypoint** runs `restore-openclaw-channel-routing.js` after configure.  
5. **Backend startup** calls `syncEnabledAgentChannelsToAgentSystem()`.  
6. **Every VPS deploy** runs `vps-verify-agent-channels.sh` (fatal on drift).
7. **Every VPS deploy** runs `vps-verify-openclaw-chat.sh` (fatal if `POST /v1/chat/completions` is **404** — usually wiped `gateway` in `openclaw.json`). Repair: `ensure-openclaw-gateway-config.js` + restart AgentSystem. Backend rewrites must use `openclaw-config-safe.js`.

Manual repair:

```bash
docker compose exec -T -w /opt/agent-os/backend backend node scripts/sync-agent-channels-to-openclaw.js
bash deploy/scripts/vps-verify-agent-channels.sh
bash deploy/scripts/vps-verify-openclaw-chat.sh
```

## Where in the UI

- Org chart agent row → **Channels**
- Agent Workspace → **Channels** link
- Route: `/agents/:agentId/channels`

## Wizard steps

1. **Choose channel** — Slack or WhatsApp  
2. **Prep** — Slack app tokens checklist, or WhatsApp phone ready  
3. **Credentials** — Slack: Bot + App tokens → vault; WhatsApp: none (QR later)  
4. **Who can message** — pairing / allowlist / open + optional allowFrom list. For WhatsApp, **group chats default to disabled** (`groupPolicy: disabled`) so `@g.us` traffic is rejected before media download — DM `allowFrom` alone does not cover groups.  
5. **Enable** — write gateway channels/bindings  
6. **Link phone** (WhatsApp) — show live QR → scan in WhatsApp → Linked devices; Slack: Run test

Status badges: `draft` | `pairing` | `enabled` | `disabled`.

## Outbound media (WhatsApp attach)

When an agent sends an image, video, or TTS audio on WhatsApp:

1. Tool results include **`paste_exactly`** / **`media_uri`** as `MEDIA:/abs/path` on the shared AgentSystem volume.
2. The agent must put that **`MEDIA:` line alone** in the reply so the gateway attaches the file from disk.
3. Pasting auth-only `https://…/api/media/…` (or signed public URLs when disabled) shows **“Media failed”** on WhatsApp.
4. Dashboard chat still plays the same file inline via `/api/media/…` while you are logged in.
5. TTS: prefer **OGG/Opus or MP3** for WhatsApp; WAV often fails attach.

**Personal assistant (COO on WhatsApp):** The COO listens to **text and voice notes** (`speech_stt`) and replies with **`From: <employee name>`** then a readable text body and a TTS voice note (`speech_tts` + `MEDIA:` attach). That is existing COO tools + Channels — not a separate PA app. Free speech needs platform `optional-voice` (Whisper + Piper). See [25-speech-and-published-scenes.md](./25-speech-and-published-scenes.md).

**Scheduled-goal outcomes on WhatsApp:** On **Scheduled goals**, opt in **Also send the final outcome on WhatsApp**. Platform copies the finished brief (chat reply, or the once-only completed/failed plan nudge) to that employee’s bound WhatsApp. Mid-step workflow terminals stay web-only. Unpaired / no DM: web still works. Help **28**.

See [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md).

## Inbound media (WhatsApp → workspace)

1. AgentSystem stages inbound bytes briefly under `~/.openclaw/media/inbound/…` **only for messages that pass channel access control** (DM policy + WhatsApp `groupPolicy`).
2. Backend mirrors them into the CEO workspace as **`inbound/attachments/<file>`** (Content Explorer) when Channels are enabled.
3. **After a successful mirror, the AgentSystem staging file is deleted** so Content Explorer is the only durable copy (no double disk use / re-sync).
4. Agents can run **`analyze_image`** (images), **`speech_stt`**, or a summarize-inbound workflow with that relative path / `MEDIA:` line.
5. If chat text says “[whatsapp attachment unavailable]”, still check `inbound/attachments/` — sync can lag a few seconds.
6. Web chat **paperclip** uploads use the same `inbound/attachments/` folder (plus Master Data).
7. WhatsApp **groups** are off by default (`groupPolicy: disabled`). Turn on allowlist/open in the Channels wizard only if you intentionally want group media.

## APIs

Authenticated CEO routes under `/api/agent-channels`:

| Method | Path | Notes |
|--------|------|--------|
| GET | `/` | List (`?agentId=`) |
| POST | `/` | Create |
| PATCH | `/:id` | Update config / credentials |
| DELETE | `/:id` | Remove + gateway cleanup |
| POST | `/:id/apply` | Write channels/bindings |
| POST | `/:id/disable` | Disable binding |
| POST | `/:id/test` | Connectivity / pairing check |
| GET | `/:id/whatsapp-qr` | Pairing status (+ cached QR if any) |
| POST | `/:id/whatsapp-qr/start` | Start QR login (`{ force?: true }`) |
| POST | `/:id/whatsapp-qr/wait` | Wait / refresh QR until scanned |

## Ops notes (shared gateway)

- Gateway must load **`whatsapp`** (`openclaw plugins install clawhub:@openclaw/whatsapp`) and **`admin-http-rpc`** (bundled; enabled by `configure-openclaw-docker.js`).
- Entrypoint runs `deploy/scripts/ensure-openclaw-channel-plugins.sh` so WhatsApp is installed on the volume if missing.
- Backend calls private `POST http://openclaw:18789/api/v1/admin/rpc` for `web.login.start` / `web.login.wait`. Do **not** expose `/api/v1/admin/rpc` on public nginx.
- Bindings use tenant agent ids from `openclaw-tenant` (`t-{ceo}--{base}`).
- Secrets never leave the vault into `ceo_agent_channels.config_json` — only vault key **names** in `vault_refs_json`.

## Related

- [15-api-keys-vault.md](./15-api-keys-vault.md)  
- [03-dashboard-agents-chat.md](./03-dashboard-agents-chat.md)  
- [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md) (MEDIA: lockdown)  
- [25-speech-and-published-scenes.md](./25-speech-and-published-scenes.md)  
- [23-avatars-virtual-room.md](./23-avatars-virtual-room.md) (Published Scenes are separate from Slack/WA)
