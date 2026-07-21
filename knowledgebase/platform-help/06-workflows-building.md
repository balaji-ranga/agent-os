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
9. Optional: **Publish as A2A** to list on AgentExchange.

## Workflow Builder agent

Chat with **Workflow Builder** (or the in-editor agent chat) to create/update graphs in natural language: add nodes, wire edges, validate, publish, test, and `until_success` loops. Prefer Workflow Builder for *building*; Platform Help for *explaining* nodes and mapping.

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

### Input modes

- **Static** — fixed value you type (URL, subject, JSON args).
- **Dynamic (From previous step)** — pick **source node** + **output key** (or auto = direct predecessor).

### Templates in prompts and fields

Use placeholders:

- `{{input}}` — common shorthand for prior text / trigger payload
- `{{nodeId.outputKey}}` — e.g. `{{brain-1.text}}`, `{{api-1.body}}`
- Nested paths when supported: `{{api-1.body.users.0.name}}`

### Outputs

Each node type exposes named outputs (see nodes reference). Downstream nodes bind to those keys. After a run, inspect step diagnostics if a binding was empty or wrong.

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
