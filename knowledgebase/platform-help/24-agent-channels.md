# Agent channels (Slack / WhatsApp)

**Audience:** CEOs enabling Slack or WhatsApp for an org agent; ops installing gateway plugins.

## What it does

Per-CEO **bring-your-own-key (BYOK)** channel enablement. You paste Slack tokens (or scan a WhatsApp QR) in a Dashboard wizard. Agent OS stores secrets in your **API Keys** vault and patches the shared gateway with tenant-scoped `channels` + `bindings` for `t-{ceo}--{agent}`.

Telegram / Discord are not in V1 (wizard may show “coming soon”).

## Where in the UI

- Org chart agent row → **Channels**
- Agent Workspace → **Channels** link
- Route: `/agents/:agentId/channels`

## Wizard steps

1. **Choose channel** — Slack or WhatsApp  
2. **Prep** — Slack app tokens checklist, or WhatsApp phone ready  
3. **Credentials** — Slack: Bot + App tokens → vault; WhatsApp: none (QR later)  
4. **Who can message** — pairing / allowlist / open + optional allowFrom list  
5. **Enable** — write gateway channels/bindings  
6. **Link phone** (WhatsApp) — show live QR → scan in WhatsApp → Linked devices; Slack: Run test

Status badges: `draft` | `pairing` | `enabled` | `disabled`.

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
- [23-avatars-virtual-room.md](./23-avatars-virtual-room.md) (Published Scenes are separate from Slack/WA)
