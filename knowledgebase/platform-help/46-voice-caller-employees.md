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

## Slow Caller — web (Home)

On Home (`/`), **Chat with** Slow Caller. Controls are **icons** in the message box next to the paperclip:

| Control | What it does | How to use |
|---------|----------------|------------|
| **Microphone** | Whisper → chat message | Click, allow mic, **speak**, then **pause 3 seconds after you finish**. The 3s timer starts only after speech is heard. Click the icon again to send sooner. |
| **Speak** checkbox | Piper reads the reply | Check it before you talk. The next assistant reply plays as audio. |
| **Phone / Call** | Live WebRTC | **Not on Slow Caller.** Hire Realtime Caller and enable **Channels → Voice**. |

HTTPS is required (already true on `login.flolah.cloud`). Platform `optional-voice` (Whisper + Piper) must be up.

### How to test web mic

1. Home → **Chat with** Slow Caller. Hard-refresh once so you see the microphone icon (not a “Mic” text button).
2. Check **Speak** if you want to hear the reply.
3. Click the **microphone**. Browser asks for permission → Allow.
4. Say a short FAQ (“what are your hours?”). Keep the mic open while you talk; **pause 3 seconds when you finish**.
5. Your turn appears, then the employee replies (and Piper plays if Speak is on).
6. If you hear nothing transcribed: speak closer, wait for “Listening” to clear, then “Transcribing…”. A real STT error shows that message (not a generic empty clip). Empty/noise shows **No speech detected**.

## Slow Caller — WhatsApp

WhatsApp is **voice notes**, not a live phone call.

1. Employee **Channels** → WhatsApp → pair QR from the phone that should receive DMs. Set **allow-from** to your E.164 number.
2. From that number, send **text**: `what are your hours?` — expect a text reply starting with **From:** the employee name.
3. Send a **voice note** (hold the WhatsApp mic). Expect a text reply plus a **Piper voice note** (`MEDIA:` attach).
4. If inbound says attachment unavailable, wait a few seconds and check Content Explorer `inbound/attachments/`.
5. Groups are off by default. Keep them off for this test.

## Slow Caller hire (once)

1. Upload FAQs / scripts to **Knowledge**.
2. Optional: Profile CRM (Twenty) if you want leads/people logged.
3. Hire **Slow Caller** (template grants `speech_*`, RAG, CRM list/create, Kanban, `agent_goal_*`).
4. Bind **WhatsApp** (above) and use Home **microphone** for CEO testing.
5. Clone workflow **Caller wrap-up** (chat: `run caller wrap up`) or let the employee create a **goal plan** after each conversation.

## Realtime Caller setup

1. Same Knowledge / CRM / wrap-up as Slow Caller.
2. Hire **Realtime Caller**.
3. **Channels → Voice (WebRTC)** → Enable. Copies a public widget URL (`/p/voice/:slug`). The **phone** icon appears in the compose toolbar only when Voice is enabled. Home **microphone** is still Whisper (turn-based); **Call** is the live path.
4. **BYOK:** Profile (or platform) must expose an **OpenAI Realtime** endpoint (`api.openai.com`). OpenRouter, Ollama, and DeepSeek **cannot** mint live sessions — you get a clear 503. Optional env: `OPENAI_REALTIME_BASE_URL`, `OPENAI_REALTIME_API_KEY`, `OPENAI_REALTIME_MODEL` (default `gpt-realtime`). Flolah mints `POST /v1/realtime/client_secrets` and the browser connects at `/v1/realtime/calls` (the retired `/v1/realtime/sessions` path is not used). Prefer owner Profile OpenAI keys; do not hardwire a platform-only model.
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
