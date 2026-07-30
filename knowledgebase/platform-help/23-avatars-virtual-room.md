# 3D Avatars & Virtual Room

**Audience:** CEOs  
**Path:** **3D Avatars** (`/avatars`) · Dashboard **Virtual Room** next to Chat.

## What you get

- Upload **GLB / GLTF** avatars (FBX not supported in V1).
- Optional **Hunyuan3D** text-to-3D when the GPU profile is enabled.
- Map one org **agent** to one avatar — creates reusable **inbound** and **outbound** workflows from templates.
- **Virtual Room**: fullscreen Three.js viewer with transcript, typed chat, and microphone input.

## Flows

**Outbound (avatar speaks):** Agent reply → **parallel** ElevenLabs Flash TTS + Brain animation planner → 3D Model playback.

The Brain receives the avatar clip catalog and returns gesture clips + idle + timed **visemes** (mouth open weights). Mouth/lip clips (e.g. `Mouth_Open_Close`) are never used as ambient idle; Virtual Room drives them from visemes while audio plays.

**Inbound (you speak):** Mic → STT → Agent → same parallel TTS + Brain → 3D Model.

ElevenLabs vault key on templates: **`elevenlabs-key`**. Re-assign the agent on **Avatars** after deploy to refresh graphs.

## Idle animation

On **3D Avatars**, pick an **Idle** clip per model (e.g. `Blink`, `Look_Around`). Virtual Room uses that clip at rest and returns to it after speech. Response gestures/visemes still come from the workflow Brain planner.

## Keys

- Vault API key named **`elevenlabs-key`** (or set `apiKeyRef` / platform `ELEVENLABS_API_KEY`).
- Brain animation node defaults to **Ollama** `llama3.2` (runs in parallel with TTS).

## Hunyuan3D (optional)

Requires NVIDIA GPU host:

```bash
# deploy/
docker compose --profile optional-hunyuan3d up -d
# set HUNYUAN3D_URL=http://hunyuan3d:7860 on backend
```

Then use **Create with Hunyuan3D** on the Avatars page.

## Workflow media

Call API nodes support `responseMode=binary` (stores audio/video as media artifacts). ElevenLabs and 3D Model nodes pass **media refs** (`artifactId` + `url`) between steps. Run detail includes a **graphical run audit** — click a node for inputs/outputs.