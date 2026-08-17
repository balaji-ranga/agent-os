# Agent channels (Slack / WhatsApp)

**Audience:** CEOs enabling Slack or WhatsApp for an org agent.

## What it does

Per-CEO **bring-your-own-key (BYOK)** channel enablement. You paste Slack tokens (or scan a WhatsApp QR) in a Dashboard wizard. Flolah stores secrets in your **API Keys** vault and binds that channel to the chosen AI employee in your tenant only.

Telegram / Discord are not in V1 (wizard may show “coming soon”).

## Reliability

Channel bindings are stored with your account. If AgentSystem is restarted, Flolah restores Slack/WhatsApp routing automatically. If a channel drops after a platform update, re-open **Channels** and **Apply**, or contact support — do not paste tokens into chat.
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

**Personal assistant (COO on WhatsApp):** The COO listens to **text and voice notes** (`speech_stt`) and replies with a readable text body and a TTS voice note (`speech_tts` + `MEDIA:` attach). The platform prepends **`From: {employee name}`** on every WhatsApp reply (keep `MEDIA:` on its own line). That is existing COO tools + Channels — not a separate PA app. Free speech needs platform `optional-voice` (Whisper + Piper). See [25-speech-and-published-scenes.md](./25-speech-and-published-scenes.md).

**Scheduled-goal outcomes on WhatsApp:** On **Scheduled goals**, opt in **Also send the final outcome on WhatsApp**. Platform copies the finished brief (chat reply, or the once-only completed/failed plan nudge) to that employee’s bound WhatsApp. `MEDIA:` TTS (own line or markdown link) is sent as a **follow-up voice note** (OGG/Opus PTT). If the reply forgot `MEDIA:` but `speech_tts` just wrote a file, the copy still attaches that recent audio. Employees must **not** call the native `message` tool with `target: "whatsapp"` — that is not a phone number. Mid-step workflow terminals stay web-only. Unpaired / no DM: web still works. Help **28**.

**Which number gets the push?** Outbound (scheduled-goal copy, server announce) uses the **first allow-from** number on that employee’s WhatsApp channel. If allow-from is empty, it uses the CEO **Profile mobile**. Store E.164 (`+6590057664`), not a local 8-digit number. Inbound DMs are different: whoever messages the **linked agent WhatsApp** (the phone that scanned QR) gets the live reply in that chat.

See [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md).

## Inbound media (WhatsApp → workspace)

1. AgentSystem stages inbound bytes briefly **only for messages that pass channel access control** (DM policy + WhatsApp group policy).
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

## Notes

- Bindings are tenant-scoped to your CEO account and that employee.
- Secrets stay in the vault; channel config stores **key names**, not the secret values.
- WhatsApp pairing uses the in-app QR wizard. Platform operators keep the WhatsApp plugin on the gateway — CEOs do not install plugins.

## Related

- [15-api-keys-vault.md](./15-api-keys-vault.md)  
- [03-dashboard-agents-chat.md](./03-dashboard-agents-chat.md)  
- [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md) (MEDIA: lockdown)  
- [25-speech-and-published-scenes.md](./25-speech-and-published-scenes.md)  
- [23-avatars-virtual-room.md](./23-avatars-virtual-room.md) (Published Scenes are separate from Slack/WA)
