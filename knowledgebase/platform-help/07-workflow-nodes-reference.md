# Workflow nodes reference (attributes, inputs, outputs)

Palette types in the visual editor. Use this when configuring nodes or answering “what does X node output?”.

---

## Trigger (`trigger`)

**Purpose:** Start of the graph.

**Key attributes:** mode `manual` | `schedule` | `chat` | `event`; `scheduleCron`; `chatPhrase`; event webhook URL/secret after save.

| Inputs | Outputs |
|--------|---------|
| (none) | `trigger_input` — initial message or schedule/event context |

---

## Agent (`agent`)

**Purpose:** Run a workspace AgentSystem agent with a prompt.

**Key attributes:** `agentId` (your org agent).

| Inputs | Outputs |
|--------|---------|
| `prompt` — static or dynamic; supports `{{input}}` | `text` — full agent reply |

---

## Brain / LLM (`brain`)

**Purpose:** Direct LLM call; optional MCP tool-calling loop; optional custom script.

**Key attributes:**

- `modelSource`: openai | anthropic | ollama | openrouter | deepseek
- `apiEndpoint`, `apiKey`, `model`, `maxTokens`, `systemPrompt`
- `thinkingMode` / `thinkingEffort` — **DeepSeek & OpenRouter only** (see below)
- `mcpToolCalling`, `mcpServerIds`, `mcpToolAllowlist`, `mcpMaxToolRounds`, `mcpServerAuth`
- `customScriptMode`: off | fallback | post | only; `customScriptId`
- Timeouts: `timeoutMs`, `timeoutAction`, `defaultTimeoutOutput`

### Thinking mode (DeepSeek / OpenRouter)

Shown in the editor only when **Model source** is `deepseek` or `openrouter`.

| Attribute | Values | Effect |
|-----------|--------|--------|
| `thinkingMode` | `enabled` (default) · `disabled` · `off` | DeepSeek: sends `thinking.type`. OpenRouter: sends unified `reasoning`. `off` omits the param (provider default). |
| `thinkingEffort` | `high` · `max` · `xhigh` · `medium` · `low` | DeepSeek uses `high`/`max`. OpenRouter also accepts `xhigh`/`medium`/`low`. Ignored when mode is disabled/off. |

**DeepSeek defaults:** cloud endpoint `https://api.deepseek.com/v1`, model `deepseek-v4-flash`, API key **on the node** (supports `{{trigger-1.trigger_input.brainApiKey}}` / `{{var.llm_key}}` — platform `.env` is not used). For local Ollama, set endpoint to `http://ollama:11434/v1` and model `deepseek-v3` (no key).

**MCP auth on Brain:** per-server headers in MCP tool-calling also accept `{{nodeId.path}}` templates (same as MCP node).

**OpenAI / Anthropic / Ollama:** no thinking controls (not applicable the same way).

| Inputs | Outputs |
|--------|---------|
| `userMessage` | `text`, `reasoning_content` (thinking trace when returned), `thinking_mode`, `model_used`, `provider`, `mcp_tools_available`, `mcp_tool_calls`, `custom_script_ran`, `custom_script_output` |

---

## CEO Approval (`ceo_approval`)

**Purpose:** Human gate on Kanban.

**Key attributes:** `title`, `instructions`.

| Inputs | Outputs |
|--------|---------|
| `summary` — context shown to CEO | `decision` (approved/rejected), `comment`, `approved` (bool), `text` |

---

## IF (`if`)

**Purpose:** Branch true/false handles.

**Key attributes:** `sourceNodeId`, `sourceOutputKey` (default `text`), `operator`, `compareValue`.

**Operators:** eq, ne, contains, not_contains, gt, lt, empty, not_empty, approved, rejected.

| Inputs | Outputs |
|--------|---------|
| (config-driven) | `result` (true/false), `text` (branch taken) |

Wire **true** and **false** handles to different paths.

---

## While (`while`)

**Purpose:** Loop until condition fails or max iterations.

**Key attributes:** same condition fields as IF + `maxIterations` (default 10). Operators exclude approved/rejected.

**Handles:** loop / exit.

| Inputs | Outputs |
|--------|---------|
| (config-driven) | `iterations`, `text` |

---

## Send Email (`email`)

**Purpose:** SMTP send.

**Key attributes:** `useEnvSmtp` (prefer platform `WORKFLOW_SMTP_*`), or node `smtpHost` / `smtpPort` / `smtpSecure` / `smtpUser` / `smtpPass` / `fromAddress`.

| Inputs | Outputs |
|--------|---------|
| `to`, `cc`, `subject`, `body` (body often dynamic) | `sent`, `attempted`, `messageId`, `error` |

For one-off CEO email from chat, prefer COO **`email_send`** tool — not a workflow — unless you want a reusable graph.

---

## Call API (`api`)

**Purpose:** HTTP request.

**Key attributes:** `method` GET/POST/PUT/PATCH/DELETE; `authType` none/basic/bearer/api_key (+ credentials); `httpHeadersJson`; timeouts.

**Dynamic auth:** Bearer / basic / API-key values and header values support `{{nodeId.path}}` (e.g. `{{api-login.body.accessToken}}`). See [14-workflow-dynamic-values.md](./14-workflow-dynamic-values.md).

| Inputs | Outputs |
|--------|---------|
| `url`, `body`, `headers` (JSON) | `status`, `body`, `ok` (2xx) |

Non-2xx / SSL failures typically fail the run.

**Response mode:** `auto` (default) | `json` | `text` | `binary`. Binary (or auto-detected audio/video/octet-stream) stores a CEO **media artifact** and outputs `audio` / `video` / `media` refs for downstream nodes.

---

## ElevenLabs (`elevenlabs`)

**Purpose:** Text-to-speech or speech-to-text via ElevenLabs; emits media refs for audio.

**Key attributes:** `mode` tts|stt; `voiceId`; `modelId` (default `eleven_flash_v2_5`); `outputFormat` (default `mp3_22050_32`); `apiKeyRef` (vault name, default `ElevenLabs`); falls back to `ELEVENLABS_API_KEY`.

| Inputs | Outputs |
|--------|---------|
| `text` (TTS), `audio` (STT media ref) | `text`, `audio` (TTS), `result`, `ok` |

---

## Speech STT (`speech_stt`)

**Purpose:** Local speech-to-text via faster-whisper (`SPEECH_STT_URL`, Compose profile `optional-voice`). No ElevenLabs key.

**Key attributes:** `model` (default `whisper-1`); optional `language`.

| Inputs | Outputs |
|--------|---------|
| `audio` (media ref) | `text`, `result`, `ok` |

---

## Analyze Image (`analyze_image`)

**Purpose:** Vision LLM describe / OCR / review for inbound images (WhatsApp / chat paperclip under `inbound/attachments/`). Platform default uses the platform **primary** LLM; BYOK Profiles use vault **Platform_BYOK**. No silent secondary fallback — if the model cannot do vision, the call fails. Prefer this over assuming the agent chat model can see pixels.

**Key attributes:** `mode` (`full`|`describe`|`ocr`|`review`); optional fixed `prompt`.

| Inputs | Outputs |
|--------|---------|
| `image` (path / MEDIA: / chat text), optional `prompt` | `text`, `description`, `ocr_text`, `ok` |

---

## Speech TTS (`speech_tts`)

**Purpose:** Local Piper text-to-speech (`SPEECH_TTS_URL`). Free alternative to ElevenLabs for workflows and Agent Chat “Speak reply”.

**Key attributes:** `voice` (Piper voice id); `lengthScale`; `speakClean` (strip avatar markup).

| Inputs | Outputs |
|--------|---------|
| `text` | `text`, `audio`, `result`, `ok` |

---

## 3D Model (`model3d`)

**Purpose:** Build a Virtual Room **playback** payload from avatar id + audio + animation JSON (full GLB clips, not lip-sync only).

| Inputs | Outputs |
|--------|---------|
| `avatarId`, `audio`, `animation`, `visemes` | `playback`, `text`, `result`, `ok` |

Animation JSON example: `{"clips":[{"name":"Wave","weight":1,"loop":false}],"idle":"Idle","visemes":[{"t":0.1,"name":"A"}]}`.

See [23-avatars-virtual-room.md](./23-avatars-virtual-room.md).

---

## External Agent / A2A (`externalAgent`)

**Purpose:** Invoke a registered third-party A2A agent.

**Key attributes:** `externalAgentId`, optional `skillId`, `waitForCompletion`, `timeoutMs`; optional **Bearer override** + `httpHeadersJson` (templates OK). Blank override → registry auth.

| Inputs | Outputs |
|--------|---------|
| `message`, optional `contextId` | `text`, `result`, `task_id`, `task_state`, `ok` |

Register agents under **External agents** first. For Flolah **secured** publishes (and similar OAuth A2A peers), obtain an access token (API node → `tokenUrl`), then set node Bearer to `{{api-….body.access_token}}` or keep a static registry header.
---

## Custom Script (`custom_script`)

**Purpose:** Run an approved sandboxed script (Python / JS / LangGraph).

**Key attributes:** `customScriptId`, display name.

| Inputs | Outputs |
|--------|---------|
| `payload` | `text`, `result`, `ok`, `script_id` |

Upload/approve scripts under **Custom scripts**.

---

## Master Data (`masterdata`)

**Purpose:** Query CEO tables or RAG documents.

**Key attributes:** `mode` auto|table|rag; `tableId`; `documentId`; `topK` (default **5**, range 1–20); `column`/`equals` filters; `summarize` (default **true** in this node — the `master_data_rag` agent tool defaults to `false`).

| Inputs | Outputs |
|--------|---------|
| `query` | `text`, `mode`, `count`, `result` |

---

## Filesystem (`filesystem`)

**Purpose:** List / exists / stat / read_text / move under allowed roots (`WORKFLOW_FS_ROOTS`). Often paired with schedule triggers to poll a folder.

**Key attributes:** `operation`, default `path`/`glob`/`destination`, `maxBytes`.

| Inputs | Outputs |
|--------|---------|
| `path`, `glob`, `destination` | `ok`, `count`, `names`, `text`, `has_files`, `files`, `path`, `result` |

---

## Web Scrape (`web_scrape`)

**Purpose:** Crawl an HTTPS website or domain (Crawlee sidecar) and optionally filter pages by search phrases.

**Key attributes:** `render` auto\|http\|playwright; `maxPages` (default 25, cap 200); `maxDepth`; same-origin; include/exclude globs; `respectRobotsTxt`; node timeout.

| Inputs | Outputs |
|--------|---------|
| `startUrl`, `phrases`, optional `cookie` | `ok`, `text`, `matches`, `pages`, `stats`, `result` |

Instagram.com with empty Cookie uses vault **`INSTAGRAM_SESSIONID`** when set. Public **IPv6** is allowed in the sidecar SSRF guard. Logged-in Chrome still uses Browser Session. Help **[44-web-scrape.md](./44-web-scrape.md)**.

---

## Content Tool (`tool`)

**Purpose:** Invoke a registered Agent OS content tool by exact name.

**Key attributes:** `toolName`, static/dynamic `toolPayload`.

| Inputs | Outputs |
|--------|---------|
| `payload` | `result` |

Discover names on **Tools** (`/content-tools`) or via Workflow Builder `content_tools_enquire`. Never invent tool names.

---

## MCP (`mcp_tool`)

**Purpose:** Call MCP tool, prompt, or resource.

**Key attributes:** `mcpInvokeKind` tool|prompt|resource; `mcpServerId`; `toolName` / `promptName` / `resourceUri`; `staticArguments` JSON; `httpHeadersJson`; timeouts.

| Inputs | Outputs |
|--------|---------|
| `arguments`, `uri` | `text`, `result`, `ok` |

Register servers under **MCP** first. Auth is usually entered on Test / per node, not stored as the only secret in the registry.

---

## SSE Listen (`mcp_listen` / `sse_listen`)

**Purpose:** Long-running SSE stream; dispatches downstream on each event.

**Key attributes:** `streamUrl` and/or `mcpServerId` + `eventsPath` (default `/events/stream`); `httpHeadersJson`.

| Inputs | Outputs |
|--------|---------|
| (none) | `event`, `text`, `event_count`, `last_event_at` |

Stop listen from run UI when needed.

---

## Sub-workflow (`sub_workflow`)

**Purpose:** Call another **published** workflow.

**Key attributes:** `targetWorkflowId`; `triggerMode` manual|event|chat; `inputTemplate`; `waitForCompletion`.

| Inputs | Outputs |
|--------|---------|
| via template | `run_id`, `run_number`, `definition_id`, `status`, `text`, `ok` |

---

## Connector (`connector`)

**Purpose:** Run an **OpenConnector** SaaS app action as the signed-in CEO (GitHub, Gmail, Drive, …).

**Prerequisite:** Connect the app under **Connectors** (`/connectors`) and provision the runtime token. See [16-connectors-openconnector.md](./16-connectors-openconnector.md).

**Key attributes:** `appId` / `appName`, `actionId`, optional connection alias; action input fields (static or `{{…}}`).

| Inputs | Outputs |
|--------|---------|
| action-specific (bound in I/O panel) | `text` — response text; `result` — full JSON |

---

## Parallel (`parallel`) / Merge (`merge`)

| Type | Inputs | Outputs |
|------|--------|---------|
| Parallel | `in` | `out` (branch signal) |
| Merge | `branches` | `merged` |

---

## Quick mapping recipes

1. **Trigger → Brain → Email:** bind Brain `userMessage` from `trigger_input`; Email `body` from Brain `text`.
2. **Agent → IF:** IF `sourceNodeId` = agent node, `sourceOutputKey` = `text`, operator `contains`, compareValue keyword; true path continues, false notifies/fails.
3. **CEO Approval → IF:** operator `approved` / `rejected` on approval outputs.
4. **API → Agent:** Agent prompt `Summarize: {{api-1.body}}`.
5. **MCP tool → Brain:** Brain `userMessage` from MCP `text` or `result`.
6. **Connector → Brain:** Brain summarizes `{{connector-1.text}}` after a GitHub/Gmail action.
7. **Web Scrape → Brain:** bind Brain `userMessage` from `{{scrape-1.text}}` (or `matches`) after a domain crawl.
