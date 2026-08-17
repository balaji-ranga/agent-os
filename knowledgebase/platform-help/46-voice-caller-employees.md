# Voice channel and Caller employees

**Audience:** CEOs hiring turn-based or live voice support employees.

Flolah does **not** ship a phone-number call center (no PSTN queue, IVR, or Twilio in core). You hire AI employees and bind **Channels**. Inbound phone numbers are a later **telephony MCP**.

## Two employees

Hire from **AI Employees** or **My Org → Design**. Pick a **role template**:

| Template | How callers reach them | Speech |
|----------|------------------------|--------|
| **Slow Caller** | WhatsApp **voice notes** + Agent Chat **Mic** | Batch Whisper STT + Piper TTS (`optional-voice`) |
| **Realtime Caller** | Agent Chat **Call** + public `/p/voice/:slug` | OpenAI **Realtime** WebRTC (barge-in). Not Whisper/Piper on the live path. |

WhatsApp voice is **not** a live call. The customer sends a voice note; the employee transcribes, thinks, and replies with text plus a Piper voice note (`MEDIA:`). See [24-agent-channels.md](./24-agent-channels.md) and [25-speech-and-published-scenes.md](./25-speech-and-published-scenes.md).

## Slow Caller setup

1. Upload FAQs / scripts to **Knowledge**.
2. Optional: Profile CRM (Twenty) if you want leads/people logged.
3. Hire **Slow Caller** (template grants `speech_*`, RAG, CRM list/create, Kanban, `agent_goal_*`).
4. Employee **Channels** → WhatsApp BYOK. Platform `optional-voice` must be up.
5. Clone workflow **Caller wrap-up** (chat: `run caller wrap up`) or let the employee create a **goal plan** after each conversation.

## Realtime Caller setup

1. Same Knowledge / CRM / wrap-up as Slow Caller.
2. Hire **Realtime Caller**.
3. **Channels → Voice (WebRTC)** → Enable. Copies a public widget URL (`/p/voice/:slug`). Agent Chat **Call** uses the same realtime path (CEO login).
4. **BYOK:** Profile (or platform) must expose an **OpenAI Realtime** endpoint (`api.openai.com`). OpenRouter, Ollama, and DeepSeek **cannot** mint live sessions — you get a clear 503. Optional env: `OPENAI_REALTIME_BASE_URL`, `OPENAI_REALTIME_API_KEY`, `OPENAI_REALTIME_MODEL` (default `gpt-4o-realtime-preview`). Prefer owner Profile OpenAI keys; do not hardwire a platform-only model.
5. Guests on the widget do **not** log in. Live tools are **read-only lookups** (RAG + CRM list). Session tokens expire (~15 min). **CEO Call** hangup posts the transcript into that employee for wrap-up (CRM/Kanban/goal). **Public widget** hangup **stores the transcript only** — it does not run a tool wrap-up, so a guest cannot inject a fake transcript into CRM.

HTTPS is required for browser microphone (already true on `login.flolah.cloud`).

## APIs

| Who | Method | Path |
|-----|--------|------|
| CEO (login) | `GET` | `/api/agents/hire-templates` |
| CEO | `POST` | `/api/agents/:id/voice/session` |
| CEO | `GET` | `/api/agents/:id/voice/status` |
| Guest | `GET` | `/api/public/voice/:slug` |
| Guest | `POST` | `/api/public/voice/:slug/session` |
| Session token | `POST` | `/api/voice/tools` |
| Session token | `POST` | `/api/voice/end` |

Never send `ceo_user_id` in the body. Logs record session id, owner, agent, tool name — not client secrets, SDP, or audio.

## What is not included

- Phone numbers, SIP, warm transfer, ACD queues, call recording UI.
- Those belong on a future telephony MCP bound to the same Voice channel — not a Flolah-specific dialer.

## Related

- [24-agent-channels.md](./24-agent-channels.md)
- [25-speech-and-published-scenes.md](./25-speech-and-published-scenes.md)
- [28-scheduled-goals.md](./28-scheduled-goals.md) (goal plans for wrap-up)
- [03-dashboard-agents-chat.md](./03-dashboard-agents-chat.md)
