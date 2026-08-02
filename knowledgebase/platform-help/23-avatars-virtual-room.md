# 3D Avatars, Virtual Rooms & Scenes

**Audience:** CEOs  
**Path:** **3D Avatars** (`/avatars`) · **Open Room** → `/vr-rooms/:roomId` · legacy `/agents/:id/virtual-room` redirects into that agent’s primary room.

## What you get

- Upload **GLB / GLTF** avatars (FBX not supported in V1).
- Optional **Hunyuan3D** text-to-3D when the GPU profile is enabled.
- Map one org **agent** to one avatar — creates reusable **inbound** and **outbound** workflows from templates.
- **Scenes:** import environment GLB/GLTF plus optional **scene JSON** (spawn points, lights, **mediaSlots** for video/chart/graph overlays).
- **Virtual Rooms:** named rooms with multiple avatar members, drag-to-reposition layout, scene picker, and **@handle** chat routing.

## Flows

**Outbound (avatar speaks):** Agent reply → **parallel** ElevenLabs Flash TTS + Brain animation planner → 3D Model playback (`sceneOutputs` optional).

The Brain receives the avatar clip catalog and room scene context (`scene_id`, `scene_name`, `media_slots`, `member_handle`) and returns gesture clips + idle + timed **visemes** plus optional **sceneOutputs** that route known agent/media results into media panel slots. Mouth/lip clips are never used as ambient idle; Virtual Room drives them from visemes while audio plays.

**Inbound (you speak):** Mic → STT → Agent → same parallel TTS + Brain → 3D Model (single-member rooms).

ElevenLabs vault key on templates: **`elevenlabs-key`**. Re-assign the agent on **Avatars** after deploy to refresh graphs.

## Virtual Rooms

1. On **3D Avatars**, create a **Virtual Room**, add members (avatars that already have agents), optionally set a scene.
2. **Open Room** loads all member GLBs and the scene environment (or an empty stage).
3. **Drag** an avatar on the floor to save layout positions.
4. **Chat:** type `@` to pick a member from the autocomplete list. With more than one member, a bare message (no `@`) is **auto-routed** using the same AGENTS.md intent classifier as COO delegation (no Kanban) — multi-intent can split across up to two members. Those members’ **outbound workflows start in parallel** (each avatar can speak/show media independently). With exactly one member, a bare message is fine. Greets (`hi`) should get a short conversational reply — the agent must not call `learnings_summary` or try to trigger another workflow.
5. Change **Scene** from the room sidebar to swap environments without leaving the room.
6. Generated **images / videos / charts** from a member’s outbound workflow open as **closable cards** stacked above that avatar (× to dismiss). New media adds a card on top; older cards stay until closed. Scene JSON **mediaSlots** are only used when Brain routes a chart/graph into a named slot.

Legacy **Virtual Room** links from the org chart still work — they open or create that agent’s primary single-member room.

## Media fulfillment (agents + model3d)

Avatar outbound workflows expect real deliverables in the agent reply:

| Ask | Agent should | Fallback if reply omits media |
|-----|--------------|-------------------------------|
| Image / photo / rendering (any subject) | `generate_image` + paste `paste_exactly` / `MEDIA:/…` (Dashboard also plays `relative_url`) | model3d calls `generate_image` from the user prompt |
| Video | `generate_video` + `MEDIA:/…` (not bare auth HTTPS) | model3d calls `generate_video` |
| Speak / voice | `speech_tts` + `MEDIA:/…` (prefer ogg/opus for WhatsApp) | Piper / ElevenLabs per room template |
| Chart / graph (pie, bar, line, area, scatter, …) | `generate_image` of that chart **or** JSON `{"type":"…","title":"…","labels":[…],"values":[…]}` | model3d fulfills via `generate_image` for the detected chart kind, or canvas chart when real values exist |

Do **not** rely on world-open absolute HTTPS media URLs — generated media is auth-only unless ops enables `MEDIA_PUBLIC_SIGNED=1`. Guest Published Scenes use separate public VR artifact tokens ([25](./25-speech-and-published-scenes.md)).

Never use a Demo/`[1,3,2,5]` placeholder chart. Multi-ask (image + chart) must produce **every** item — stacked cards, newest on top.

Shared agent guidance: `openclaw-workspace-templates/_shared/AGENT-OS-OPS.md` (§ Virtual Room / avatar media) and TechResearcher `TOOLS.md`.

## Scenes & media overlays
Scene JSON example:

```json
{
  "spawnPoints": [{ "id": "a", "position": [0, 0, 0] }],
  "mediaSlots": [
    { "id": "panel-1", "position": [1.2, 1.4, -1.5], "rotation": [0, 0, 0], "scale": [1.6, 0.9, 1], "kind": "chart" }
  ]
}
```

When the agent reply includes chart-like JSON (or Brain emits `sceneOutputs`), Virtual Room draws a canvas chart/video/image plane at the slot transform. Card overlays are preferred for generated media in the room UI.
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
