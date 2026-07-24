# Building custom workflows (end to end)

## Job workflows vs Workflows

| | **Job workflows** (`/job-workflows`) | **Workflows** (`/workflows`) |
|--|--------------------------------------|------------------------------|
| Purpose | Fixed Job Applicant pipeline | Your visual graphs |
| Orchestration | Pipeline agents + cron | Backend workflow runner |
| Design | Profile-driven, not a free canvas | Drag-and-drop + Workflow Builder chat |

This doc is about **custom Workflows**.

## Lifecycle

1. Open **Workflows** → create **blank** or from **template** (e.g. Job Applicant template).
2. Open **Edit** → `/workflows/:workflowId/edit`.
3. Drag nodes from the palette; connect edges.
4. Configure each node (attributes + **Input / Output** bindings).
5. **Save draft**.
6. **Publish** (required before Run). Use **Unpublish** to take offline.
7. **Run** with optional run input; watch progress on the runs panel (`?run_id=`).
8. **Import / Export JSON** for backup or sharing definitions.
9. Optional: **Publish as A2A** (Public or Secured OAuth) to list on AgentExchange.
10. Optional: **Download for Windows** — run a published workflow from a laptop (local graph + localhost/filesystem; state and remote nodes on Flolah). See [17-desktop-windows-download.md](./17-desktop-windows-download.md).

## Workflow Builder agent

Chat with **Workflow Builder** (or the in-editor agent chat) to create/update graphs in natural language: add nodes, wire edges, validate, publish, test, and `until_success` loops. For **end-to-end autonomous certify** (Maker/Checker + status-on-request), see [13-workflow-autonomous-certify.md](./13-workflow-autonomous-certify.md). Prefer Workflow Builder for *building*; Platform Help for *explaining* nodes and mapping.

## Trigger modes (Trigger node)

| Mode | Behavior |
|------|----------|
| **manual** | You click Run (or API start). |
| **schedule** | Cron expression (`scheduleCron`). |
| **chat** | Phrase match (`chatPhrase`) — agents/COO can trigger via tools. |
| **event** | Webhook after save; send with `X-Workflow-Hook-Secret`. Public base URL from `AGENT_OS_BASE_URL` / public URL env. |

Output of Trigger: **`trigger_input`** (initial payload / message / schedule context).

## Input / output mapping (critical)

Open the node’s **Input / Output** panel.

### Optional trigger input JSON Schema

On the **Trigger** start node you can set an **optional input JSON Schema**. When present:

- Webhook (`event`), manual **Run**, A2A invoke, and COO `agent_workflow_trigger` validate the payload before the run starts.
- **Publish as A2A** copies the schema into the agent card skill (`inputSchema`) and AgentExchange listing.
- Leave empty to keep free-form text / any JSON (legacy behavior).
- Prefer a schema with a `message` string property if chat/A2A clients send plain text — the platform wraps text as `{ "message": "..." }`.

### Input modes

- **Static** — fixed value you type (URL, subject, JSON args). May still include `{{…}}` templates.
- **Dynamic (From previous step)** — pick **source node** + **output key** (or auto = direct predecessor).
- **Workflow variable** — when the binding mode is offered, read from the definition’s variables panel.

### Templates in prompts and fields

Full guide: **[14-workflow-dynamic-values.md](./14-workflow-dynamic-values.md)**.

Quick reference:

| Pattern | Example |
|---------|---------|
| Prior step output | `{{brain-1.text}}`, `{{api-1.body}}` |
| Nested JSON | `{{api-login.body.accessToken}}`, `{{trigger-1.trigger_input.query}}` |
| Workflow variable | `{{var.budget_usd}}` / `{{variables.api_base}}` |
| Trigger / run shorthand | `{{input}}` |

**Workflow variables** (editor panel) are shared static config for **this** workflow — there is no separate platform-wide global store. Use them for budgets, base URLs, allowlists; use prior-step templates for run-time tokens and results.

**Auth:** Prefer **Management → API Keys** vault refs for long-lived secrets ([15-api-keys-vault.md](./15-api-keys-vault.md)). API, MCP, Brain (`apiKey` + MCP headers), SSE Listen, External Agent (optional override), and **Connector** nodes also accept `{{nodeId.path}}` in bearer/header fields. Values look static in the UI; the runner substitutes at execute time. SaaS apps: connect under **Connectors** before using a **Connector** node ([16-connectors-openconnector.md](./16-connectors-openconnector.md)).

### Outputs

Each node type exposes named outputs (see nodes reference). Downstream nodes bind to those keys. After a run, inspect step diagnostics if a binding was empty or wrong.

**Brain tip:** For DeepSeek or OpenRouter, set **Thinking mode** on the node (Enabled / Disabled / Off). Bind downstream fields to `text` for the final answer, or `reasoning_content` if you need the thinking trace. Brain `apiKey` can be `{{trigger-1.trigger_input.brainApiKey}}` (BYOK) — platform `.env` keys are not used for workflow Brain.

### Timeouts (many long-running nodes)

Shared fields often include:

- `timeoutMs` (default often ~20 minutes)
- `timeoutAction`: `fail` or `default_output`
- `defaultTimeoutOutput` — JSON/text when using default_output

## Parallel and merge

- **Parallel** — fan-out the same signal to multiple branches.
- **Merge** — wait for branches and continue with merged context.

## CEO Approval gates

**CEO Approval** creates a Kanban item. The run waits until you approve/reject. Downstream **IF** nodes can use operators `approved` / `rejected`.

## Runs and Kanban

- Each run appears in Workflows run history (search, paginate).
- Steps often create Kanban tasks; failures (non-2xx API, MCP `is_error`, SSL errors) fail the run.
- For **SSE Listen**, you can stop listening on an active run from the UI/API.

## Validation checklist before Publish

1. Exactly one Trigger (start).
2. Edges connect the intended path (IF true/false, While loop/exit).
3. Every required input is static or bound.
4. Agent nodes pick a real `agentId`; MCP nodes pick a registered server; External Agent nodes pick a registered A2A agent.
5. Chat/schedule/event trigger fields filled for that mode.
6. Publish, then Run with a small test payload.
