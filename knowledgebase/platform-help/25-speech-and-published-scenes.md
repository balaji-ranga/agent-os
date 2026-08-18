# Free speech (Whisper STT + Piper TTS) + Published Scenes

**Audience:** CEOs using Agent Chat mic / workflow speech nodes; builders swapping ElevenLabs for free nodes; guests opening public Virtual Rooms.

## Published Scenes (public Virtual Rooms)

1. **3D Avatars** → Virtual Rooms → add members → **Publish**.  
2. Copy the public URL (`/p/vr/:slug`) or open **Published Scenes** in the nav.  
3. Guests need **no login**. Chat is stored only in the browser (`sessionStorage`) — nothing is written to the CEO transcript DB.  
4. **@handle** in guest chat routes to that member’s outbound workflow (not intent fallback). TTS audio for guests is served via a **slug-scoped public VR token** (`/api/public/vr/:slug/artifacts/…?t=…`) — this is **not** the same as ops `MEDIA_PUBLIC_SIGNED` for AgentSystem `/api/media/…`. Lip/gesture animation plays on the addressed avatar.  
5. **Unpublish** disables guest access (slug may be kept for republish).

Guest chat is rate-limited and only runs outbound workflows of room members. Vault / workflow edit is not exposed.

Mobile: public page stacks the 3D canvas above a bottom chat sheet (`max-width: 900px`).

## Free STT / TTS (optional-voice)

Deploy profile **`optional-voice`** (auto-started by `deploy/scripts/ensure-voice-env.sh` from `up.sh` / `vps-deploy-latest.sh`). **faster-whisper** (MIT) and **Piper** (MIT) — see `/legal/open-source.html`.

```bash
# Manual (same as deploy helper):
docker compose --profile optional-voice up -d --build whisper piper
# Skip on a host: SKIP_VOICE=1 bash scripts/vps-deploy-latest.sh
```

Env (written by `ensure-voice-env.sh` if missing — see `deploy/.env.example`):

- `SPEECH_STT_URL=http://whisper:8000` — OpenAI-compatible faster-whisper  
- `SPEECH_TTS_URL=http://piper:5500` — Piper HTTP (WAV)

### Agent Chat

- **Microphone** (compose toolbar, next to paperclip) — records audio → `POST /api/speech/stt` → fills compose text. Same control on Home (`/`) after **Chat with** any employee, including Slow Caller.
- **Speak** (Piper) — `POST /api/speech/tts` for the last assistant message (not ElevenLabs).

### Content tools + WhatsApp

| Tool | Purpose |
|------|---------|
| `speech_tts` | Text → audio; returns `MEDIA:` for WhatsApp attach + auth `/api/media` for Dashboard inline player. Prefer **ogg/opus** (or mp3) for WhatsApp; WAV often fails attach. |
| `speech_stt` | Transcribe from artifact / `MEDIA:` / `inbound/attachments/…` path (web upload or channel inbound). |

Generated AgentSystem media stays **auth-only** unless `MEDIA_PUBLIC_SIGNED=1`. See [11](./11-content-tools-scripts-profile.md) and [24](./24-agent-channels.md).

### Workflow nodes

| Type | Purpose |
|------|---------|
| `speech_stt` | Audio media ref → transcript (local Whisper) |
| `speech_tts` | Text → audio media artifact (Piper) |
| `elevenlabs` | Unchanged paid TTS/STT |

Avatar templates still default to ElevenLabs. Builders can swap to `speech_*` for zero-cost rooms.

Without the Compose profile / env URLs, speech APIs and nodes return **503** with a clear message.

## Related

- [23-avatars-virtual-room.md](./23-avatars-virtual-room.md)  
- [07-workflow-nodes-reference.md](./07-workflow-nodes-reference.md)  
- [24-agent-channels.md](./24-agent-channels.md)  
- [46-voice-caller-employees.md](./46-voice-caller-employees.md) (Slow Caller WhatsApp notes vs Realtime WebRTC — not Whisper/Piper on the live path)
- [21-external-tools-and-apis.md](./21-external-tools-and-apis.md) (ElevenLabs keys)
