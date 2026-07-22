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

**Purpose:** Run a workspace OpenClaw agent with a prompt.

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
- `mcpToolCalling`, `mcpServerIds`, `mcpToolAllowlist`, `mcpMaxToolRounds`, `mcpServerAuth`
- `customScriptMode`: off | fallback | post | only; `customScriptId`
- Timeouts: `timeoutMs`, `timeoutAction`, `defaultTimeoutOutput`

| Inputs | Outputs |
|--------|---------|
| `userMessage` | `text`, `model_used`, `provider`, `mcp_tools_available`, `mcp_tool_calls`, `custom_script_ran`, `custom_script_output` |

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

**Key attributes:** `method` GET/POST/PUT/PATCH/DELETE; `authType` none/basic/bearer/api_key (+ credentials); timeouts.

| Inputs | Outputs |
|--------|---------|
| `url`, `body`, `headers` (JSON) | `status`, `body`, `ok` (2xx) |

Non-2xx / SSL failures typically fail the run.

---

## External Agent / A2A (`externalAgent`)

**Purpose:** Invoke a registered third-party A2A agent.

**Key attributes:** `externalAgentId`, optional `skillId`, `waitForCompletion`, `timeoutMs`.

| Inputs | Outputs |
|--------|---------|
| `message`, optional `contextId` | `text`, `result`, `task_id`, `task_state`, `ok` |

Register agents under **External agents** first. For Flolah **secured** publishes (and similar OAuth A2A peers), put a Bearer **access token** (from the agent’s token URL) in the registry auth header — not the long-lived `client_secret`.

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

**Key attributes:** `mode` auto|table|rag; `tableId`; `documentId`; `topK`; `column`/`equals` filters; `summarize`.

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

## Content Tool (`tool`)

**Purpose:** Invoke a registered Agent OS content tool by exact name.

**Key attributes:** `toolName`, static/dynamic `toolPayload`.

| Inputs | Outputs |
|--------|---------|
| `payload` | `result` |

Discover names on **Content tools** or via Workflow Builder `content_tools_enquire`. Never invent tool names.

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
